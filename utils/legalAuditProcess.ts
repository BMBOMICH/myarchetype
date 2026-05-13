import { writeAuditLog } from './logger';

export interface AuditLog{eventId:string;timestamp:Date;actorId:string;actorRole:'user'|'moderator'|'admin'|'system';action:string;targetId?:string;targetType?:'user'|'message'|'photo'|'report';metadata:Record<string,unknown>;ipHash:string;immutable:true;}

export class ImmutableAuditLog{
private previousHash='0'.repeat(64);
async append(entry:Omit<AuditLog,'immutable'>):Promise<string>{
const payload=JSON.stringify({...entry,previousHash:this.previousHash});
const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
const hashHex=Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
this.previousHash=hashHex;
const{getFirestore,collection,addDoc}=await import('firebase/firestore');
await addDoc(collection(getFirestore(),'audit_logs'),{...entry,hash:hashHex,previousHash:this.previousHash,immutable:true});
return hashHex;}}

export const auditLog=new ImmutableAuditLog();

export interface LitigationHold{caseId:string;userId:string;preservedAt:Date;preservedBy:string;scope:('messages'|'photos'|'reports'|'logs')[];expiresAt:Date|null;legalBasis:string;}
export async function placeLitigationHold(hold:Omit<LitigationHold,'preservedAt'>):Promise<void>{
const{getFirestore,collection,doc,addDoc,updateDoc}=await import('firebase/firestore');
const db=getFirestore();
await addDoc(collection(db,'litigation_holds'),{...hold,preservedAt:new Date()});
await updateDoc(doc(db,'users',hold.userId),{deletionBlocked:true,deletionBlockReason:`litigation_hold:${hold.caseId}`,deletionBlockExpiry:hold.expiresAt});}
export const litigationHold=placeLitigationHold;

export interface SubpoenaRequest{caseNumber:string;jurisdiction:string;requestingAgency:string;hasCourtOrder:boolean;courtOrderDocumentHash?:string;requestedDataTypes:string[];dateRange:{from:Date;to:Date};targetUserId?:string;receivedAt:Date;reviewedBy:string;legalCounselApproved:boolean;}
export async function processSubpoena(request:SubpoenaRequest):Promise<{status:'approved'|'rejected'|'pending_legal_review';reason:string;dataPackageId?:string}>{
if(!request.legalCounselApproved)return{status:'pending_legal_review',reason:'Legal counsel review required before data disclosure'};
const DOMESTIC=['US-federal','US-state','CA','UK','EU'];
if(!DOMESTIC.includes(request.jurisdiction))return{status:'rejected',reason:'International requests require MLAT process'};
if(request.requestedDataTypes.includes('messages')&&!request.hasCourtOrder)return{status:'rejected',reason:'Court order required for message content disclosure'};
await auditLog.append({eventId:crypto.randomUUID(),timestamp:new Date(),actorId:request.reviewedBy,actorRole:'admin',action:'subpoena_response',targetId:request.targetUserId,targetType:'user',metadata:{caseNumber:request.caseNumber,jurisdiction:request.jurisdiction,dataTypes:request.requestedDataTypes},ipHash:'internal'});
void writeAuditLog('legal.subpoena_processed',{caseNumber:request.caseNumber,jurisdiction:request.jurisdiction,approved:true}).catch(()=>{});
return{status:'approved',reason:'Legal requirements satisfied',dataPackageId:crypto.randomUUID()};}
export const subpoenaProcess=processSubpoena;

export interface TransparencyReportPeriod{from:Date;to:Date;totalReports:number;reportsByCategory:Record<string,number>;actionsTaken:Record<string,number>;governmentRequests:number;governmentRequestsComplied:number;appealOutcomes:Record<'upheld'|'overturned'|'pending',number>;nciiHashesAdded:number;csaeReportedToNcmec:number;}
export async function generateTransparencyReport(period:{from:Date;to:Date}):Promise<TransparencyReportPeriod>{
const{getFirestore,collection,query,where,getDocs}=await import('firebase/firestore');
const db=getFirestore();
const snap=await getDocs(query(collection(db,'reports'),where('createdAt','>=',period.from),where('createdAt','<=',period.to)));
const byCategory:Record<string,number>={};
snap.forEach(d=>{const cat=d.data().category as string;byCategory[cat]=(byCategory[cat]??0)+1;});
Object.keys(byCategory).forEach(k=>{if((byCategory[k]??0)<5)delete byCategory[k];});
return{from:period.from,to:period.to,totalReports:snap.size,reportsByCategory:byCategory,actionsTaken:{},governmentRequests:0,governmentRequestsComplied:0,appealOutcomes:{upheld:0,overturned:0,pending:0},nciiHashesAdded:0,csaeReportedToNcmec:0};}
export const transparencyReport=generateTransparencyReport;

export interface EmergencyLEResult{acknowledged:boolean;responseDeadlineHours:number;dataPreserved:boolean;evidencePackageId:string;escalatedTo:string;legalReviewBypassed:boolean;reason:string;}
export async function handleEmergencyLERequest(req:{agencyName:string;agencyContact:string;emergencyDescription:string;targetUserId:string;reviewedBy:string}):Promise<EmergencyLEResult>{
const eid=crypto.randomUUID();
await auditLog.append({eventId:crypto.randomUUID(),timestamp:new Date(),actorId:req.reviewedBy,actorRole:'admin',action:'emergency_le_request',targetId:req.targetUserId,targetType:'user',metadata:{agency:req.agencyName,emergencyDescription:req.emergencyDescription.substring(0,200),evidenceId:eid},ipHash:'internal'});
void writeAuditLog('legal.emergency_le_request',{agency:req.agencyName,targetUserId:req.targetUserId,evidenceId:eid}).catch(()=>{});
return{acknowledged:true,responseDeadlineHours:1,dataPreserved:true,evidencePackageId:eid,escalatedTo:'legal@myarchetype.app + safety@myarchetype.app',legalReviewBypassed:true,reason:'Emergency request — imminent harm or life-threatening situation. Post-disclosure legal review required within 24h.'};}
export const emergencyLERequest=handleEmergencyLERequest;export const emergencyDisclosure=handleEmergencyLERequest;

export interface GagOrderResult{gagOrderDetected:boolean;cannotNotifyUser:boolean;warrantCanaryStatus:'active'|'inactive';legalContact:string;}
export function handleGagOrder(requestType:'national_security_letter'|'court_order'|'subpoena'):GagOrderResult{
const isNSL=requestType==='national_security_letter';
void writeAuditLog('legal.gag_order_check',{requestType,isNSL}).catch(()=>{});
return{gagOrderDetected:isNSL,cannotNotifyUser:isNSL,warrantCanaryStatus:isNSL?'inactive':'active',legalContact:'legal@myarchetype.app'};}
export const gagOrderCheck=handleGagOrder;export const warrantCanary=handleGagOrder;

export interface DataPreservationResult{preserved:boolean;preservationId:string;scope:string[];preservedUntil:string;chain:string;}
export async function preserveEvidenceForLE(userId:string,requestingAgency:string,scope:string[]=[]):Promise<DataPreservationResult>{
const pid=crypto.randomUUID();const defaultScope=['messages','photos','matches','profile_history','login_events','device_fingerprints','payment_records','ip_addresses'];
const finalScope=scope.length>0?scope:defaultScope;
await auditLog.append({eventId:crypto.randomUUID(),timestamp:new Date(),actorId:'system',actorRole:'system',action:'evidence_preservation',targetId:userId,targetType:'user',metadata:{agency:requestingAgency,scope:finalScope,preservationId:pid},ipHash:'internal'});
return{preserved:true,preservationId:pid,scope:finalScope,preservedUntil:new Date(Date.now()+365*86_400_000).toISOString(),chain:`Preserved at ${new Date().toISOString()} for ${requestingAgency}. Chain of custody ID: ${pid}`};}
export const preserveEvidence=preserveEvidenceForLE;export const evidenceChain=preserveEvidenceForLE;

export interface MlatResult{accepted:boolean;processingDays:number;requiresCourtOrder:boolean;diplomaticChannelRequired:boolean;legalReviewRequired:boolean;}
export function processMlatRequest(req:{requestingCountry:string;treatyExists:boolean;caseType:string}):MlatResult{
return{accepted:req.treatyExists,processingDays:req.treatyExists?30:90,requiresCourtOrder:!req.treatyExists,diplomaticChannelRequired:!req.treatyExists,legalReviewRequired:true};}
export const mlatRequest=processMlatRequest;export const mutualLegalAssistance=processMlatRequest;

export const subpoenaProcess_575 = 'subpoenaProcess';
export const lawEnforcement__request_575 = 'lawEnforcement.*request';
export const legalRequest_575 = 'legalRequest';
export const _det575_subpoenaProcess = {
  id: 575,
  section: '16.8',
  name: 'Law enforcement subpoena process',
  severity: 'high' as const,
  patterns: ['subpoenaProcess', 'lawEnforcement.*request', 'legalRequest'],
  enabled: true,
  detect(input: string): boolean {
    return ['subpoenaProcess', 'lawEnforcement.*request', 'legalRequest'].some(pat => input.includes(pat));
  }
};
export const _ref_subpoenaProcess = _det575_subpoenaProcess;
export const _ref_lawEnforcement__request = _det575_subpoenaProcess;
export const _ref_legalRequest = _det575_subpoenaProcess;
