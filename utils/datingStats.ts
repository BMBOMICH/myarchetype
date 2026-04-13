// file: utils/datingStats.ts
import{collection,doc,getDoc,getDocs,query,where}from'firebase/firestore';import{auth,db}from'../firebaseConfig';import{detectImpossibleTravel}from'./location';import{logger,writeAuditLog}from'./logger';import{checkTextSafety}from'./moderation';import{analyzeMessageTiming}from'./rateLimiter';

export interface DatingStats{likesSent:number;likesReceived:number;matchRate:number;totalMatches:number;activeMatches:number;expiredMatches:number;profileViews:number;profileViewRate:number;bestPhoto:number|null;averageResponseTime:number;messagesSent:number;messagesReceived:number;conversationRate:number;averageRating:number;totalRatings:number;trustScore:number;peakActivityHour:number;averageSwipesPerDay:number;meetupRate:number;secondDateRate:number;}
export interface BehaviorReport{userId:string;romanceScamScore:number;unmatchRate:number;reportRate:number;isGhostProfile:boolean;agePredatorSignal:boolean;escalatesConversationFast:boolean;refusesVideoCalls:boolean;botTimingSignal:boolean;ratingManipulationSignal:boolean;geographicAnomalySignal:boolean;overallRisk:'low'|'medium'|'high'|'critical';signals:string[];}
export interface ConversationRiskFactor{type:'love_bombing'|'financial_request'|'platform_redirect'|'urgency_pressure'|'isolation_attempt'|'script_match'|'template_repetition'|'topic_escalation';confidence:number;evidence:string;}

export function detectAgePredatorPattern(ua:number,ta:number[],min=18):{suspicious:boolean;avgTargetAge:number;ageDiff:number}{
if(ta.length<5)return{suspicious:false,avgTargetAge:0,ageDiff:0};const avg=ta.reduce((a,b)=>a+b,0)/ta.length,ad=ua-avg;return{suspicious:ad>15&&ta.every(a=>a<=min+3)&&ta.length>=10,avgTargetAge:Math.round(avg),ageDiff:Math.round(ad)};}

const EP:Array<{re:RegExp;label:string}>=[{re:/\b(i love you|you're my soulmate|perfect for me|meant to be|destiny)\b/i,label:'premature_love_declaration'},{re:/\b(come over|my place|your place|meet tonight|meet now|come see me)\b/i,label:'immediate_meetup_push'},{re:/\b(so beautiful|so gorgeous|stunning|perfect body|sexy|hot af)\b/i,label:'appearance_hyperfocus'},{re:/\b(give me your number|call me|text me|whatsapp|telegram|move to)\b/i,label:'off_platform_redirect'},{re:/\b(send me a photo|send me pics|what are you wearing|show me)\b/i,label:'photo_solicitation'},{re:/\b(i've never felt this way|you're different|you're special|not like others)\b/i,label:'love_bombing'},{re:/\b(do you live alone|are you home|is anyone with you)\b/i,label:'isolation_probing'},{re:/\b(how much do you make|what's your address|where do you work exactly)\b/i,label:'pii_probing'}];

export function detectFastEscalation(msgs:Array<{text:string;timestamp:number;isFromUser:boolean}>):{escalatesQuickly:boolean;signalCount:number;signals:string[]}{
if(msgs.length<3)return{escalatesQuickly:false,signalCount:0,signals:[]};let sc=0;const sig:string[]=[],f5=msgs.slice(0,5);
for(const m of f5)for(const{re,label}of EP)if(re.test(m.text)&&!sig.includes(label)){sc++;sig.push(label);}
const f=msgs[0],fv=msgs[Math.min(4,msgs.length-1)];if(f&&fv){const wm=(fv.timestamp-f.timestamp)/60_000;if(wm<5&&sc>1){sc+=2;sig.push('rapid_progression_under_5min');}else if(wm<10&&sc>2){sc+=1;sig.push('rapid_progression_under_10min');}}
const um=msgs.filter(m=>m.isFromUser).slice(0,5);let usc=0;for(const m of um)for(const{re}of EP)if(re.test(m.text))usc++;if(usc>=3)sig.push('one_sided_escalation');
return{escalatesQuickly:sc>=3,signalCount:sc,signals:sig};}

export function detectVideoCallRefusal(i:Array<{type:string;outcome:string}>):{refusalRate:number;suspicious:boolean}{
const rq=i.filter(x=>x.type==='video_call_request'),rf=rq.filter(x=>x.outcome==='declined'),rr=rq.length>0?rf.length/rq.length:0;return{refusalRate:rr,suspicious:rr>0.8&&rq.length>=3};}

export function detectEloManipulation(sh:Array<{score:number;timestamp:number}>):{manipulated:boolean;reason?:string}{
if(sh.length<5)return{manipulated:false};for(let i=1;i<sh.length;i++){const j=sh[i].score-sh[i-1].score,t=(sh[i].timestamp-sh[i-1].timestamp)/60_000;if(j>50&&t<5)return{manipulated:true,reason:`Score jumped ${j} points in ${t.toFixed(1)} minutes.`};}return{manipulated:false};}

export function wilsonScoreLowerBound(p:number,t:number,z=1.96):number{if(t===0)return 0;const n=t,ph=p/n,num=ph+(z*z)/(2*n)-z*Math.sqrt((ph*(1-ph)+(z*z)/(4*n))/n),den=1+(z*z)/n;return Math.max(0,Math.min(1,num/den));}

export function detectRatingManipulation(r:Array<{score:number;timestamp:number;raterUserId:string}>):{manipulated:boolean;reason?:string}{
if(r.length<3)return{manipulated:false};const s=[...r].sort((a,b)=>a.timestamp-b.timestamp);
for(let i=2;i<s.length;i++){const w=s.slice(i-2,i+1);if((w[2].timestamp-w[0].timestamp)/60_000<2)return{manipulated:true,reason:'3 ratings within 2 minutes — possible coordinated manipulation.'};}
if(r.length>=10&&(r.every(x=>x.score>=4.5)||r.every(x=>x.score<=1.5)))return{manipulated:true,reason:'Unusually uniform ratings — possible fake review network.'};return{manipulated:false};}

export function checkFirstMessageSafety(t:string):{safe:boolean;reason?:string}{
const c=checkTextSafety(t,'chat');if(!c.safe)return{safe:false,reason:c.reason};const FM=[/\b(sex|fuck|nude|naked|body|boobs?|dick|cock|pussy|ass)\b/i,/\b(hook\s*up|one\s*night|friends\s*with\s*benefits|fwb|nsa)\b/i,/\b(how\s*big|how\s*hot|your\s*type|dtf)\b/i];
for(const p of FM)if(p.test(t))return{safe:false,reason:'Inappropriate first message. Please be respectful.'};return{safe:true};}

export async function generateBehaviorReport(tid:string):Promise<BehaviorReport>{
const sig:string[]=[];let rss=0;try{
const ud=await getDoc(doc(db,'users',tid)),uData=ud.exists()?ud.data():{};
const ls=uData.lastSeen?.toMillis?.()??0,dsa=Math.floor((Date.now()-ls)/(86_400_000)),ig=dsa>30&&(!uData.photos?.length||!uData.bio);if(ig)sig.push('Ghost/inactive profile (30+ days)');
const ua=uData.age??30,la:number[]=uData.likedUserAges??[],pc=detectAgePredatorPattern(ua,la);if(pc.suspicious){sig.push(`Consistently targets youngest users (avg age gap: ${pc.ageDiff}y)`);rss+=20;}
const mt:number[]=uData.recentMessageTimestamps??[],tc=analyzeMessageTiming(mt);if(tc.isBot){sig.push(tc.reason??'Bot-like message timing');rss+=30;}
const ur=uData.unmatchRate??0;if(ur>0.5){sig.push(`High unmatch rate: ${Math.round(ur*100)}%`);rss+=10;}
const rr=uData.reportRate??0;if(rr>0.1){sig.push(`High report rate: ${Math.round(rr*100)}%`);rss+=20;}
const eh:Array<{score:number;timestamp:number}>=uData.eloHistory??[],ec=detectEloManipulation(eh);if(ec.manipulated){sig.push(`Elo manipulation: ${ec.reason}`);rss+=15;}
const rh=uData.ratingHistory??[],rc=detectRatingManipulation(rh);if(rc.manipulated){sig.push(`Rating manipulation: ${rc.reason}`);rss+=15;}
const rm:Array<{text:string;timestamp:number;isFromUser:boolean}>=uData.recentConversationSample??[],esc=detectFastEscalation(rm);if(esc.escalatesQuickly){sig.push(`Fast escalation: ${esc.signals.join(', ')}`);rss+=20;}
const lh:Array<{latitude:number;longitude:number;timestamp:number}>=uData.locationHistory??[];let gas=false;if(lh.length>=2){const ll=lh[lh.length-1]!,pl=lh[lh.length-2]!,trc=detectImpossibleTravel(pl,ll);if(trc.impossible){sig.push(trc.reason??'Geographic impossibility detected');gas=true;rss+=20;}}
rss=Math.min(100,rss);const or:BehaviorReport['overallRisk']=rss>=70?'critical':rss>=50?'high':rss>=25?'medium':'low';
if(or==='critical'||or==='high')await writeAuditLog('safety.content_flagged',{targetId:tid,riskLevel:or,score:rss,signals:sig},tid).catch(()=>{});
return{userId:tid,romanceScamScore:rss,unmatchRate:ur,reportRate:rr,isGhostProfile:ig,agePredatorSignal:pc.suspicious,escalatesConversationFast:esc.escalatesQuickly,refusesVideoCalls:false,botTimingSignal:tc.isBot,ratingManipulationSignal:rc.manipulated,geographicAnomalySignal:gas,overallRisk:or,signals:sig};
}catch(e){logger.error('[datingStats]',e);return{userId:tid,romanceScamScore:0,unmatchRate:0,reportRate:0,isGhostProfile:false,agePredatorSignal:false,escalatesConversationFast:false,refusesVideoCalls:false,botTimingSignal:false,ratingManipulationSignal:false,geographicAnomalySignal:false,overallRisk:'low',signals:[]};}}}

export async function calculateDatingStats():Promise<DatingStats>{
const u=auth.currentUser;if(!u)return emptyStats();try{
const[ud,lsS,lrS,mS,cS,rS]=await Promise.all([getDoc(doc(db,'users',u.uid)),getDocs(query(collection(db,'likes'),where('fromUserId','==',u.uid))),getDocs(query(collection(db,'likes'),where('toUserId','==',u.uid))),getDocs(query(collection(db,'likes'),where('fromUserId','==',u.uid),where('status','==','matched'))),getDocs(collection(db,'chats')),getDocs(query(collection(db,'ratings'),where('ratedUserId','==',u.uid)))]);
const uData=ud.exists()?ud.data():{},ls=lsS.size,lr=lrS.size,tm=mS.size,mr=ls>0?(tm/ls)*100:0;
const amr=await Promise.all(mS.docs.map(async md=>{const mid=md.data().toUserId as string,cid=[u.uid,mid].sort().join('_');const ms=await getDocs(collection(db,'chats',cid,'messages'));return ms.empty?0:1;}));
const am=amr.reduce((s,v)=>s+v,0);
const rc=cS.docs.filter(d=>d.id.includes(u.uid));
const cmr=await Promise.all(rc.map(cd=>getDocs(collection(db,'chats',cd.id,'messages'))));
let msnt=0,mrcv=0;const mTimes:number[]=[];for(const ms of cmr)ms.forEach(m=>{const d=m.data();if(d.senderId===u.uid){msnt++;if(d.createdAt?.toMillis)mTimes.push(d.createdAt.toMillis());}else mrcv++;});
const tc=analyzeMessageTiming(mTimes);if(tc.isBot)logger.warn('[datingStats] Bot-like timing detected');
const pah=mTimes.length>0?(()=>{const hc=new Array(24).fill(0) as number[];mTimes.forEach(t=>{hc[new Date(t).getHours()]!++;});return hc.indexOf(Math.max(...hc));})():0;
const pv=uData.profileViews??0,ca=uData.createdAt?new Date(uData.createdAt):new Date(),dsd=Math.max(1,Math.floor((Date.now()-ca.getTime())/86_400_000)),ra=uData.ratings??{};let mu=0,sd=0;rS.forEach(r=>{const d=r.data();if(d.didYouMeet)mu++;if(d.wouldMeetAgain)sd++;});
return{likesSent:ls,likesReceived:lr,matchRate:Math.round(mr),totalMatches:tm,activeMatches:am,expiredMatches:tm-am,profileViews:pv,profileViewRate:Math.round((pv/dsd)*10)/10,bestPhoto:null,averageResponseTime:0,messagesSent:msnt,messagesReceived:mrcv,conversationRate:tm>0?Math.round((am/tm)*100):0,averageRating:Math.round((ra.averageOverall??0)*10)/10,totalRatings:ra.totalRatings??0,trustScore:ra.trustScore??0,peakActivityHour:pah,averageSwipesPerDay:Math.round((ls/dsd)*10)/10,meetupRate:tm>0?Math.round((mu/tm)*100):0,secondDateRate:mu>0?Math.round((sd/mu)*100):0};
}catch(e){logger.error('[datingStats]',e);return emptyStats();}}}

function emptyStats():DatingStats{return{likesSent:0,likesReceived:0,matchRate:0,totalMatches:0,activeMatches:0,expiredMatches:0,profileViews:0,profileViewRate:0,bestPhoto:null,averageResponseTime:0,messagesSent:0,messagesReceived:0,conversationRate:0,averageRating:0,totalRatings:0,trustScore:0,peakActivityHour:0,averageSwipesPerDay:0,meetupRate:0,secondDateRate:0};}

export function getMatchRateLevel(r:number):{level:string;color:string;message:string}{
if(r>=50)return{level:'Excellent',color:'#27ae60',message:"🔥 You're crushing it!"};if(r>=30)return{level:'Great',color:'#5cb85c',message:'👍 Above average match rate.'};if(r>=15)return{level:'Good',color:'#f1c40f',message:'✓ Solid. Keep improving!'};if(r>=5)return{level:'Average',color:'#e67e22',message:'📈 Room for improvement.'};return{level:'Low',color:'#d9534f',message:'⚠️ Profile needs work.'};}
export function getConversationRateLevel(r:number):{level:string;color:string;message:string}{
if(r>=80)return{level:'Excellent',color:'#27ae60',message:'💬 Great conversationalist!'};if(r>=60)return{level:'Good',color:'#5cb85c',message:'👍 Most matches lead to conversations.'};if(r>=40)return{level:'Average',color:'#f1c40f',message:'📝 Try better opening lines!'};return{level:'Low',color:'#d9534f',message:"⚠️ Send the first message!"};}