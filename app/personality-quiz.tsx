/**
 * PersonalityQuizScreen — 5-dimension personality assessment (v4.0)
 */
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Platform, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../firebaseConfig';
import { useLanguage } from '../utils/LanguageContext';
import { appStorage } from '../utils/storage';

/* ═══ CONSTANTS ═══ */
const QUIZ_VERSION='4.0',TOTAL_QUESTIONS=30,INSIGHT_INTERVAL=6,ANSWER_DELAY_MS=350,BAR_ANIM_MS=800,BAR_DELAY_MS=150,SAVE_TIMEOUT_MS=15_000,DRAFT_KEY='pq_draft_v4',ANALYTICS_KEY='pq_analytics',PENDING_SAVE_KEY='pq_pending_save';
const IS_WEB=Platform.OS==='web';
const HIT={top:12,bottom:12,left:12,right:12} as const;
const SCORE_STRONG_A=0,SCORE_LEAN_A=25,SCORE_NEUTRAL=50,SCORE_LEAN_B=75,SCORE_STRONG_B=100;
const THRESH_STRONG_LOW=30,THRESH_LEAN_LOW=43,THRESH_LEAN_HIGH=57,THRESH_STRONG_HIGH=70;

/* ═══ DESIGN TOKENS ═══ */
const C={bg:'#1a1a2e',card:'#16213e',cardHi:'#1d2b4f',input:'#0f3460',accent:'#53a8b6',success:'#5cb85c',danger:'#d9534f',warning:'#e67e22',purple:'#9b59b6',gold:'#f1c40f',text:'#eeeeee',sub:'#b0b0b0',muted:'#999999',dim:'#777777',white:'#ffffff',none:'transparent'} as const;

/* ═══ TYPES ═══ */
const TRAIT_KEYS=['energy','planning','emotion','social','adventure'] as const;
type TraitKey=typeof TRAIT_KEYS[number];
type AnswerScore=0|25|50|75|100;
interface TraitDef{readonly key:TraitKey;readonly name:string;readonly lowLabel:string;readonly highLabel:string;readonly lowEmoji:string;readonly highEmoji:string;readonly color:string;readonly description:string}
interface QuizQuestion{readonly id:number;readonly trait:TraitKey;readonly question:string;readonly sideA:string;readonly sideB:string;readonly scenario:string;readonly weight:number}
interface AnswerOption{readonly id:number;readonly score:AnswerScore;readonly emoji:string;readonly side:'A'|'neutral'|'B'}
interface RelationshipInsights{readonly whatYouBring:readonly string[];readonly whatYouNeed:readonly string[];readonly greenFlags:readonly string[];readonly redFlags:readonly string[];readonly howYouLove:string;readonly commonChallenge:string;readonly reflectionPrompt:string}
interface Archetype{readonly code:string;readonly name:string;readonly emoji:string;readonly title:string;readonly description:string;readonly strengths:readonly string[];readonly growthAreas:readonly string[];readonly communicationStyle:string;readonly conflictStyle:string;readonly idealDates:readonly string[];readonly loveLanguageFit:string;readonly relationship:RelationshipInsights}
interface TraitScore{readonly key:TraitKey;readonly score:number;readonly label:string;readonly consistency:number}
interface QuizResults{readonly archetype:Archetype;readonly archetypeCode:string;readonly traits:readonly TraitScore[];readonly adventureScore:number;readonly overallConsistency:number;readonly summary:string;readonly quizVersion:string;readonly completedAt:string;readonly totalTimeMs:number;readonly questionTimesMs:readonly number[];readonly rawAnswers:Record<number,AnswerScore>}
interface InsightCard{readonly emoji:string;readonly title:string;readonly body:string}
interface RelationshipDynamic{readonly tagline:string;readonly strength:string;readonly watchOut:string;readonly selfNote?:string}

/* ═══ TRAIT DEFINITIONS ═══ */
const TRAITS:readonly TraitDef[]=Object.freeze([
  {key:'energy',   name:'Energy',    lowLabel:'Introvert',      highLabel:'Extrovert',       lowEmoji:'🌙',highEmoji:'☀️', color:'#9b59b6',description:'How you recharge and where you draw energy from'},
  {key:'planning', name:'Planning',  lowLabel:'Spontaneous',    highLabel:'Structured',      lowEmoji:'🌊',highEmoji:'📋',color:'#3498db',description:'How you organise your life and make decisions'},
  {key:'emotion',  name:'Decisions', lowLabel:'Head (Logic)',   highLabel:'Heart (Feeling)', lowEmoji:'🧠',highEmoji:'❤️', color:'#e74c3c',description:'Whether you lead with logic or feelings'},
  {key:'social',   name:'Connection',lowLabel:'Independent',    highLabel:'People-Person',   lowEmoji:'🏔️',highEmoji:'🤗',color:'#2ecc71',description:'How you build and maintain relationships'},
  {key:'adventure',name:'Adventure', lowLabel:'Comfort-Seeker', highLabel:'Thrill-Seeker',   lowEmoji:'🏠',highEmoji:'🚀',color:'#e67e22',description:'How you approach new experiences and change'},
]);
const TRAIT_MAP=Object.freeze(Object.fromEntries(TRAITS.map(t=>[t.key,t])) as Record<TraitKey,TraitDef>);

/* ═══ ANSWER OPTIONS ═══ */
const ANSWER_OPTIONS:readonly AnswerOption[]=Object.freeze([
  {id:0,score:SCORE_STRONG_A as AnswerScore,emoji:'💯',side:'A'},
  {id:1,score:SCORE_LEAN_A   as AnswerScore,emoji:'👍',side:'A'},
  {id:2,score:SCORE_NEUTRAL  as AnswerScore,emoji:'🤷',side:'neutral'},
  {id:3,score:SCORE_LEAN_B   as AnswerScore,emoji:'👍',side:'B'},
  {id:4,score:SCORE_STRONG_B as AnswerScore,emoji:'💯',side:'B'},
]);

/* ═══ QUESTIONS ═══ */
const QUESTIONS:readonly QuizQuestion[]=Object.freeze([
  {id:1, trait:'energy',   weight:1.5,scenario:'🔋 How you recharge',      question:'After a long, exhausting day, your ideal evening is:',                               sideA:'Solo time — book, music, peaceful quiet at home',                              sideB:'Calling friends to meet up, being around people'},
  {id:2, trait:'energy',   weight:1,  scenario:'🎉 Social situations',      question:'You arrive at a party where you know almost no one:',                                sideA:'Stick with the 1-2 people you know, or slip out early',                        sideB:'Thrive on it — work the room, introduce yourself to everyone'},
  {id:3, trait:'energy',   weight:1,  scenario:'✈️ Travel style',           question:'Your dream vacation looks like:',                                                    sideA:'Secluded cabin, nature walks alone, reading by the fire',                      sideB:'Group trip with packed itinerary, nightlife, and adventures'},
  {id:4, trait:'energy',   weight:1.5,scenario:'💭 Processing style',       question:'When you need to think through an important life decision:',                         sideA:'You need complete solitude to think clearly',                                  sideB:'You talk it through with as many people as possible'},
  {id:5, trait:'energy',   weight:1,  scenario:'⚡ After socialising',      question:'After three hours at a lively social event, you feel:',                              sideA:'Drained and ready to go home — you need to decompress alone',                  sideB:'Energised and wishing it would go on longer'},
  {id:6, trait:'energy',   weight:1,  scenario:'🏢 Work environment',       question:'Your ideal work setup is:',                                                         sideA:'Private office or working from home — minimal interruptions',                  sideB:'Open, buzzing space where collaboration happens naturally'},
  {id:7, trait:'planning', weight:1.5,scenario:'📅 Making plans',           question:'Your approach to weekend plans:',                                                    sideA:'Wake up and see what happens — go with the flow',                              sideB:'By Friday night you have Saturday and Sunday mapped out'},
  {id:8, trait:'planning', weight:1,  scenario:'🏠 Your space',             question:'Your personal space (room, desk, kitchen) is usually:',                              sideA:'Organised chaos — messy but you know where everything is',                     sideB:'Everything labelled, sorted, and in its designated place'},
  {id:9, trait:'planning', weight:1,  scenario:'🚗 Spontaneity test',       question:"A friend texts: 'Road trip tomorrow, you in?'",                                     sideA:'"I\'m in!" — throw things in a bag and figure it out',                        sideB:'"Let me check my calendar, plan the route, and pack properly"'},
  {id:10,trait:'planning', weight:1.5,scenario:'💑 First date approach',    question:'Planning a first date with someone new:',                                            sideA:'"Let\'s meet at 7 and see where the night takes us"',                          sideB:'Reservation booked, menu reviewed, outfit picked yesterday'},
  {id:11,trait:'planning', weight:1,  scenario:'🧳 Travel prep',            question:'How you pack for a week-long trip:',                                                 sideA:'Toss things in a bag the morning of — wing it',                                sideB:'Packing list, rolled clothes, outfits planned per day'},
  {id:12,trait:'planning', weight:1,  scenario:'📋 New project',            question:'When starting a big new project at work or home:',                                   sideA:'Dive straight in and figure it out as you go',                                 sideB:'Spend time planning the steps before touching anything'},
  {id:13,trait:'emotion',  weight:1.5,scenario:'🤝 Supporting others',      question:'Your friend has been venting for an hour and asks "what do you think I should do?":', sideA:'Walk them through a clear, practical action plan',                            sideB:'Ask more questions to help them find their own answer'},
  {id:14,trait:'emotion',  weight:1,  scenario:'💼 Big decisions',          question:'Choosing between two apartments to rent:',                                           sideA:'Spreadsheet comparing price, commute, square footage, amenities',              sideB:'Go with the one that "feels like home" when you walk in'},
  {id:15,trait:'emotion',  weight:1.5,scenario:'💬 Conflict style',         question:'During a disagreement with your partner:',                                           sideA:'You build a logical case, present facts, stay composed',                       sideB:'You express how hurt or frustrated you feel, get emotional'},
  {id:16,trait:'emotion',  weight:1,  scenario:'🎬 Emotional expression',   question:'A movie has a deeply emotional, gut-wrenching ending:',                              sideA:'You appreciate the filmmaking craft but stay composed',                        sideB:'Tears flowing — you feel everything and are not ashamed'},
  {id:17,trait:'emotion',  weight:1,  scenario:'🎁 Gift-giving approach',   question:'Buying a gift for someone you love:',                                                sideA:'Research the most useful, practical, well-reviewed option',                    sideB:'Choose something with deep sentimental meaning, even if impractical'},
  {id:18,trait:'emotion',  weight:1,  scenario:'⚡ Quick decisions',        question:'When you need to make a fast decision with limited information:',                     sideA:'Quickly list pros and cons — logic wins even under pressure',                  sideB:'Trust your gut — your instinct has rarely steered you wrong'},
  {id:19,trait:'social',   weight:1.5,scenario:'💕 Relationship needs',     question:'In a relationship, your ideal week together looks like:',                            sideA:'2-3 quality hangouts; the rest is sacred personal time',                       sideB:'Together most evenings, sharing daily routines and meals'},
  {id:20,trait:'social',   weight:1,  scenario:'🧠 Coping style',           question:'Three days after a major personal setback, you:',                                    sideA:'Have processed it mostly alone and feel ready to move on',                     sideB:'Have talked it through with several people and feel better for it'},
  {id:21,trait:'social',   weight:1,  scenario:'🏡 Living preferences',     question:'Your ideal living situation:',                                                       sideA:'Solo apartment, or just you and a partner — your sanctuary',                   sideB:'Roommates, communal space, neighbours always dropping by'},
  {id:22,trait:'social',   weight:1,  scenario:'🤔 Social circles',         question:'When it comes to social circles with a partner:',                                    sideA:'You prefer maintaining mostly separate friend groups',                         sideB:'You love combining social circles and building a shared community'},
  {id:23,trait:'social',   weight:1.5,scenario:'🎂 Celebrations',           question:"It's your birthday. Your ideal celebration:",                                        sideA:'Quiet dinner with 1-3 of your closest people (or just you)',                   sideB:'Huge party with everyone you know — the more the merrier'},
  {id:24,trait:'social',   weight:1,  scenario:'🎉 Sharing joy',            question:'You just received amazing, life-changing news:',                                     sideA:'Savor it quietly first, tell a few people gradually',                          sideB:'Immediately call everyone, share it everywhere, celebrate loudly'},
  {id:25,trait:'adventure',weight:1.5,scenario:'🌍 Change tolerance',       question:"You're offered a job in a country you've never visited:",                            sideA:'Prefer the comfort and stability of your current life',                        sideB:'Already looking at flights — a whole new chapter!'},
  {id:26,trait:'adventure',weight:1,  scenario:'🍽️ New experiences',       question:'At a restaurant with an unusual, adventurous menu:',                                 sideA:'Find the familiar dish you know you will enjoy',                               sideB:'Order the most exotic thing you have never tried'},
  {id:27,trait:'adventure',weight:1,  scenario:'📝 Life goals',             question:'Your bucket list is mostly filled with:',                                            sideA:'A beautiful home, deep expertise in one skill, annual tradition trips, close rituals',sideB:'Move to a new country, say yes to everything for a year, 50 new experiences'},
  {id:28,trait:'adventure',weight:1,  scenario:'🎯 Exploration style',      question:'Your approach to hobbies and interests:',                                            sideA:'Deep mastery of a few things you love — depth over breadth',                   sideB:'Always picking up something new — variety is the spice of life'},
  {id:29,trait:'adventure',weight:1,  scenario:'💼 Career approach',        question:'In your career, you gravitate toward:',                                              sideA:'Stable path, clear progression, work-life balance, no surprises',              sideB:'Startup energy, pivoting, risk-taking, chasing ambitious goals'},
  {id:30,trait:'adventure',weight:1.5,scenario:'❤️ Dating adventures',      question:'A date suggests something completely outside your comfort zone:',                     sideA:'Suggest something classic instead — dinner, walk, coffee',                     sideB:'Love it — escape room, pottery class, midnight hike, whatever'},
]);

/* ═══ INSIGHT CARDS ═══ */
const INSIGHTS:readonly InsightCard[]=Object.freeze([
  {emoji:'🧬',title:'Did you know?',         body:'Personality traits are about 40-60% heritable, but your experiences shape how they express themselves in relationships.'},
  {emoji:'💕',title:'Similarity matters',     body:'Research shows people generally feel most understood by partners with similar core values and emotional styles — not necessarily opposites.'},
  {emoji:'📊',title:'Fun fact',               body:'People who understand their own personality type report 23% higher relationship satisfaction — self-awareness is genuinely attractive.'},
  {emoji:'🧠',title:'Almost there!',          body:'Your answers are forming a unique personality fingerprint. No two profiles are exactly alike, even within the same archetype.'},
]);

/* ═══ TRAIT DYNAMICS ═══ */
interface TraitDynamic{readonly trait:TraitKey;readonly bothHigh:string;readonly bothLow:string;readonly userHighPartnerLow:string;readonly userLowPartnerHigh:string}
const TRAIT_DYNAMICS:readonly TraitDynamic[]=Object.freeze([
  {trait:'energy',   bothHigh:'You both love being around people — social life will feel natural and energising.',bothLow:"You both honour quiet. Home is a sanctuary, not a performance. You will never have to explain needing alone time.",userHighPartnerLow:'You want more social time than they do. Respecting their recharge time is everything here.',userLowPartnerHigh:'They bring social energy; you bring depth and calm. The balance can be beautiful if neither feels forced.'},
  {trait:'planning', bothHigh:'Shared love of structure means smooth logistics and no ambiguity. Watch: who leads when plans fall apart?',bothLow:'Life together is spontaneous and free. Watch: important things may never get properly organised.',userHighPartnerLow:'You plan; they flow. Works well if they appreciate your structure without feeling controlled.',userLowPartnerHigh:'They plan; you adapt. Works well if their structure feels like care, not control.'},
  {trait:'emotion',  bothHigh:'Emotionally rich connection. You both feel deeply and express it. Conflicts may be intense but resolve with genuine understanding.',bothLow:'You solve problems together with clarity and logic. Watch: important feelings may quietly go unspoken.',userHighPartnerLow:'You lead with feeling; they lead with logic. They may seem cold to you — you may feel overwhelming to them. Mutual respect is everything.',userLowPartnerHigh:'They bring warmth; you bring clarity. Together you cover both sides of most decisions.'},
  {trait:'social',   bothHigh:'You both invest deeply in relationships. Rich, connected partnership with strong community around you.',bothLow:'You both value independence. Plenty of space, deep trust. Watch: who reaches out first during hard times?',userHighPartnerLow:'You want closeness; they need space. Clear communication about what distance means to each of you is essential.',userLowPartnerHigh:'They seek closeness; you need space. Their love language may be presence — yours may be space. Worth discussing early.'},
  {trait:'adventure',bothHigh:'Life together is exciting and ever-changing. Watch: who grounds you both when stability is needed?',bothLow:'You both find comfort in the familiar. Routines feel like love, not boredom. Watch: may resist necessary change together.',userHighPartnerLow:'You want new experiences; they want comfort. Neither should always have to compromise — find adventures you can both enjoy.',userLowPartnerHigh:'They push you toward new things; you bring them home. Can be a genuinely beautiful balance.'},
]);

function getRelationshipDynamic(userCode:string,partnerCode:string):RelationshipDynamic{
  const isSelf=userCode===partnerCode;
  const lines=TRAIT_DYNAMICS.map((td,i)=>{
    const uH=userCode[i]==='H',pH=partnerCode[i]==='H';
    if(uH&&pH)   return td.bothHigh;
    if(!uH&&!pH) return td.bothLow;
    if(uH&&!pH)  return td.userHighPartnerLow;
    return td.userLowPartnerHigh;
  });
  const sameBits=userCode.split('').filter((c,i)=>c===partnerCode[i]).length;
  const pct=Math.round((sameBits/5)*100);
  const tagline=isSelf?'Deep mutual understanding':pct>=80?'Very similar — strong natural understanding':pct>=60?'More alike than different':pct>=40?'Complementary differences':'Opposite in many ways — high growth potential';
  return {tagline,strength:lines[0]??'',watchOut:lines[2]??'',...(isSelf?{selfNote:"Many people find their deepest connection with someone who truly understands them — don't let anyone tell you 'too similar' is a problem."}:{})};
}

/* ═══ ARCHETYPES ═══ */
const ARCHETYPES:Readonly<Record<string,Archetype>>=Object.freeze({
  LLLLL:{code:'LLLLL',name:'The Philosopher',emoji:'🦉',title:'Deep Thinker',description:'Introspective, logical, and comfortable in solitude. You see the world through a unique analytical lens and value depth over surface connection.',strengths:['Wise','Self-aware','Thoughtful','Principled'],growthAreas:['Opening up emotionally','Initiating social plans','Letting go of overthinking','Being spontaneous with feelings'],communicationStyle:'Measured and precise. You think before you speak and prefer meaningful conversations over small talk.',conflictStyle:'You withdraw to process, then return with a well-reasoned perspective. You can seem emotionally distant during arguments.',idealDates:['Bookshop browsing followed by a quiet café','Documentary screening and discussion','Museum visit and philosophical dinner conversation'],loveLanguageFit:'Quality Time & Words of Affirmation',relationship:{whatYouBring:['Rare intellectual depth your partner may never find elsewhere','Loyalty that is quiet but completely unshakeable','Thoughtfulness — you notice and remember everything that matters','A calm, steady presence that others find grounding'],whatYouNeed:['A partner who respects your solitude without making it a problem','Intellectual stimulation — surface conversation drains you','Patience while you process; you always come back','Genuine depth, not performance'],greenFlags:['They are comfortable with silence','They have their own rich inner world','They never rush you to "just talk about it"','They appreciate a well-chosen gift over a grand gesture'],redFlags:['They mock your need for alone time','They find depth "exhausting" or "too serious"','They require constant social validation','They cannot sit with ambiguity'],howYouLove:'Quietly and with extraordinary precision. You show love through remembering, through a single perfectly chosen word, through showing up when it truly matters.',commonChallenge:'You may analyse feelings so thoroughly that expressing them in the moment feels impossible. Your partner may need more real-time reassurance than you naturally give.',reflectionPrompt:'What would it feel like to be with someone who never once made you feel like "too much" — and never made you feel like "not enough"?'}},
  LLLLH:{code:'LLLLH',name:'The Quiet Adventurer',emoji:'🌌',title:'Introverted Explorer',description:'Private and logical, yet driven by a restless hunger for new experiences. You explore the world deeply, on your own terms and timeline.',strengths:['Curious','Self-reliant','Observant','Quietly bold'],growthAreas:['Sharing excitement with others','Letting people in on your inner world','Finishing what you start','Accepting support'],communicationStyle:'Sparse but meaningful. Every word is chosen. You prefer showing over telling.',conflictStyle:'You go quiet and need space. You return calmer but may not revisit the emotional core of the conflict.',idealDates:['Solo museum visit you describe to them later over dinner','Hiking somewhere neither of you has been','Watching a foreign film and discussing it for hours'],loveLanguageFit:'Quality Time & Acts of Service',relationship:{whatYouBring:['The ability to make ordinary moments feel like discoveries','Deep independence that never becomes clingy','A perspective unlike anyone else your partner has met','Quiet loyalty — you show up for the people who matter'],whatYouNeed:['Freedom to pursue your curiosity without justification','A partner who is genuinely interested in your inner world','Space between adventures — you need to integrate experiences alone','Someone who does not need you to be "on" all the time'],greenFlags:['They ask follow-up questions about your thoughts','They have their own passions they pursue independently','They are comfortable with unconventional plans','They do not pressure you to share before you are ready'],redFlags:['They need constant check-ins and reassurance','They find your independence threatening','They cannot handle silence or uncertainty','They confuse your quiet with indifference'],howYouLove:'Through experiences you create and curate for them. Through the things you share from your inner world — which is rarely shared at all.',commonChallenge:'You experience life so richly inside that communicating it outward can feel unnecessary — but your partner needs access to that world to feel close to you.',reflectionPrompt:'What would it mean to invite someone fully into your inner world — not just the surface of it?'}},
  LLLHL:{code:'LLLHL',name:'The Sensitive Soul',emoji:'🌸',title:'Quiet Empath',description:'You feel deeply and process quietly. Your emotional intelligence is a superpower, even if the world does not always see it that way.',strengths:['Empathetic','Perceptive','Authentic','Creative'],growthAreas:['Setting emotional boundaries','Not absorbing others\' stress','Speaking up for your needs','Building resilience to criticism'],communicationStyle:'Gentle and intuitive. You pick up on unspoken feelings and communicate through warmth more than words.',conflictStyle:'You feel hurt deeply but may not express it immediately. You need reassurance the relationship is safe before opening up.',idealDates:['Art gallery followed by a heartfelt conversation','Sunset walk along the water','Cooking together with soft music playing'],loveLanguageFit:'Words of Affirmation & Physical Touch',relationship:{whatYouBring:['The ability to make your partner feel truly seen — perhaps for the first time','Emotional intelligence most people spend decades trying to develop','Loyalty that goes bone-deep once trust is established','Creativity and depth in how you love'],whatYouNeed:['A partner who never makes you feel "too much" or "too sensitive"','Gentleness during conflict — harsh words stay with you long after','Space to recharge without guilt or explanation required','Someone who values depth and meaning over efficiency'],greenFlags:['They are comfortable with emotional conversations','They have their own depth and inner world','They notice small things and appreciate small gestures','They never mock your emotional responses','They check in without overwhelming you'],redFlags:['They dismiss things that matter deeply to you','They make you feel responsible for managing their emotions AND yours','They see your sensitivity as a flaw to correct','They need constant high stimulation and cannot slow down'],howYouLove:'Quietly, deeply, and with extraordinary attention to detail. You remember everything that matters. You create safety without even trying.',commonChallenge:'You absorb the emotional states of those around you as your own. Learning where your feelings end and your partner\'s begin is important, ongoing work.',reflectionPrompt:'What does it feel like when someone truly sees you without trying to change you — and what would it mean to build a whole relationship on that feeling?'}},
  LLLHH:{code:'LLLHH',name:'The Dreamer',emoji:'🌙',title:'Imaginative Free Spirit',description:'Creative, emotionally rich, and quietly adventurous. You follow your heart, see beauty everywhere, and inspire others with your vision.',strengths:['Imaginative','Passionate','Compassionate','Inspiring'],growthAreas:['Following through on plans','Staying grounded in reality','Handling practical details','Not taking criticism personally'],communicationStyle:'Expressive and poetic. You use stories, metaphors, and emotion to communicate.',conflictStyle:'You feel conflicts intensely and may become overwhelmed. You need time to process emotions before resolution.',idealDates:['Open mic poetry night','Painting or pottery class together','Spontaneous drive to watch the sunrise'],loveLanguageFit:'Words of Affirmation & Gifts (meaningful ones)',relationship:{whatYouBring:['A sense of wonder that makes ordinary life feel magical','Deep emotional availability and romantic intensity','Creative love — you invent ways to make your partner feel special','Vision for a shared future that inspires both of you'],whatYouNeed:['A partner who supports your dreams without grounding them in cynicism','Emotional connection before practical decisions','Room to be impractical sometimes — not everything needs to be efficient','Someone who can hold you steady when feelings overwhelm you'],greenFlags:['They find your creativity inspiring, not exhausting','They can hold space for your emotions without trying to fix them','They appreciate sentiment over practicality','They have their own dreams they are chasing'],redFlags:['They prioritise efficiency over meaning','They dismiss your ideas before you finish explaining them','They are emotionally unavailable or dismissive of feeling','They need everything planned and structured'],howYouLove:'With colour, with gestures, with meaning. You love like a story — and you want your partner to feel like the main character.',commonChallenge:'The intensity of your inner world can make the practical side of relationships feel exhausting. The gap between the love you imagine and the love you live in is worth paying attention to.',reflectionPrompt:'What would a relationship feel like that matched the depth of feeling you carry inside — without requiring you to shrink it?'}},
  LLHLL:{code:'LLHLL',name:'The Architect',emoji:'🏗️',title:'Strategic Planner',description:'Methodical, independent, and logical. You build your life with precision, purpose, and quiet determination.',strengths:['Strategic','Reliable','Efficient','Detail-oriented'],growthAreas:['Loosening up and being playful','Expressing emotions openly','Adapting when plans change','Showing affection spontaneously'],communicationStyle:'Clear, structured, and to the point. You organise your thoughts before speaking.',conflictStyle:'You approach conflict methodically — identify the problem, propose solutions. Emotion-heavy arguments frustrate you.',idealDates:['Wine tasting with structured pairings','Escape room challenge','Well-planned day trip to a historic town'],loveLanguageFit:'Acts of Service & Quality Time',relationship:{whatYouBring:['A partner who can always be counted on — completely','Practical love: you fix, plan, and build a stable life together','Clear communication — no guessing what you mean','Long-term thinking that creates real security'],whatYouNeed:['A partner who appreciates that your acts of service ARE your love language','Space to process before discussing emotional topics','Respect for your systems — they are how you care for your world','Directness — you cannot read between lines you were not told about'],greenFlags:['They appreciate actions over words','They are direct about their needs without drama','They understand that your quiet is not coldness','They have their own competence and independence'],redFlags:['They need constant emotional reassurance you cannot always give','They take your problem-solving as dismissiveness','They are chaotic and resent your structure','They mistake your logic for a lack of feeling'],howYouLove:'Through doing. Through building. Through showing up reliably, every single time, without needing credit for it.',commonChallenge:'You may solve your partner\'s emotional problems when they just needed to be heard. Learning to ask "do you want support or solutions?" is one of the most powerful things you can do.',reflectionPrompt:'What would it feel like to be loved for exactly how you love — practically, reliably, and completely — without being asked to perform emotions you do not feel?'}},
  LLHLH:{code:'LLHLH',name:'The Pathfinder',emoji:'🧭',title:'Logical Explorer',description:'Independent, analytical, and driven by curiosity. You chart your own course through life with quiet conviction and a hunger for new discovery.',strengths:['Analytical','Curious','Self-directed','Resilient'],growthAreas:['Inviting others into your process','Expressing emotional needs','Settling into stability','Letting people help you'],communicationStyle:'Direct and information-dense. You communicate to inform, not to perform.',conflictStyle:'You disengage from conflict until you have processed it fully. You return with a solution but may miss the emotional repair needed.',idealDates:['Road trip with no fixed destination','A challenging puzzle or strategy game','Visiting somewhere off the usual tourist map'],loveLanguageFit:'Acts of Service & Quality Time',relationship:{whatYouBring:['Genuine independence — you will never be a burden','Intellectual richness your partner can learn from endlessly','Reliability when it truly matters','A unique lens on the world that keeps partnership interesting'],whatYouNeed:['Freedom to explore without justification','A partner secure enough not to need constant reassurance','Intellectual engagement — small talk alone will not sustain you','Someone who respects your process, even when it is slow'],greenFlags:['They pursue their own growth alongside you','They ask real questions and listen to the answers','They do not need you to be emotionally demonstrative to feel loved','They are secure in themselves'],redFlags:['They interpret your independence as rejection','They need to process everything verbally and immediately','They are threatened by your competence','They mistake your logic for emotional unavailability'],howYouLove:'Steadily and practically. Through the long game — loyalty, reliability, and a depth of attention that reveals itself slowly.',commonChallenge:'Your self-sufficiency can make your partner feel unnecessary. Letting them contribute — even when you do not need it — is an act of love.',reflectionPrompt:'What would it feel like to let someone fully in — not just to your ideas, but to the full experience of being you?'}},
  LLHHL:{code:'LLHHL',name:'The Idealist',emoji:'🕊️',title:'Values-Driven Thinker',description:'You combine deep feeling with clear principles. Quiet on the outside, but your inner world is vivid, principled, and intensely alive.',strengths:['Principled','Empathetic','Focused','Authentic'],growthAreas:['Accepting imperfection in others','Not over-idealising relationships','Being flexible when values conflict','Sharing your inner world more freely'],communicationStyle:'Thoughtful and values-laden. You say less than you feel but everything you say matters.',conflictStyle:'You avoid conflict until it feels unavoidable, then express everything at once. This can feel intense to others.',idealDates:['Ethical restaurant with a shared cause','Volunteering together','A meaningful film and a long conversation after'],loveLanguageFit:'Quality Time & Words of Affirmation',relationship:{whatYouBring:['A relationship built on genuine values, not convenience','Deep loyalty — you do not love lightly or leave easily','Emotional depth that makes your partner feel truly known','Integrity in how you show up, every day'],whatYouNeed:['A partner whose values align with yours — this is non-negotiable','Authenticity — performance and pretence exhaust you','Space to hold feelings before expressing them','Someone who respects your principles even when they differ'],greenFlags:['They live by values, not just talk about them','They appreciate depth in conversation','They are honest even when it is inconvenient','They never pressure you to compromise your principles'],redFlags:['They are performative rather than genuine','They mock what you care about','They need you to be lighter than you are','They mistake your depth for negativity'],howYouLove:'With complete devotion to who your partner truly is — not who you wish they were. Though you must guard against loving the ideal more than the person.',commonChallenge:'Your standards are high — for yourself and unconsciously for others. The gap between who people are and who you hoped they would be can be a source of quiet grief.',reflectionPrompt:'What would it mean to love someone exactly as they are — not as they could become?'}},
  LLHHH:{code:'LLHHH',name:'The Wandering Soul',emoji:'🌿',title:'Gentle Explorer',description:'Quiet, feeling, and hungry for meaningful experience. You move through the world softly but leave a deep impression on everyone you truly connect with.',strengths:['Empathetic','Adventurous','Creative','Deeply feeling'],growthAreas:['Grounding your emotions','Following through','Not romanticising instability','Building sustainable routines'],communicationStyle:'Evocative and feeling-led. You speak in experiences and emotions more than facts.',conflictStyle:'You feel conflict in your whole body and need space before you can speak. Resolution requires emotional safety first.',idealDates:['Spontaneous trip to somewhere meaningful','Cooking a cuisine you\'ve never tried together','A long walk that turns into an unexpected adventure'],loveLanguageFit:'Physical Touch & Words of Affirmation',relationship:{whatYouBring:['A love that is alive — full of texture, feeling, and surprise','The ability to make your partner feel deeply accompanied in life','Emotional attunement that is genuinely rare','Openness to experience that keeps the relationship from going stale'],whatYouNeed:['A partner who can hold steady when your emotions are in motion','Freedom to explore without feeling tied down before you are ready','Deep emotional availability — you cannot sustain surface-level love','Someone who finds your depth beautiful, not exhausting'],greenFlags:['They are emotionally available and do not shame feelings','They love experiencing new things with you','They are grounded enough to balance your flow','They never make you feel "too much"'],redFlags:['They need constant stability and resist all change','They are emotionally shut down or dismissive','They confuse your wandering with unreliability','They cannot sit with emotional complexity'],howYouLove:'Fully and experientially. You love in moments — in the texture of a shared evening, in a song you send at midnight, in a trip you plan around their favourite thing.',commonChallenge:'The gap between the richness of your emotional experience and your ability to communicate it can leave partners feeling confused about where they stand.',reflectionPrompt:'What does it feel like to be fully present with someone — not thinking about the past version or the future possibility, just the person right here?'}},
  LHLLL:{code:'LHLLL',name:'The Lone Wolf',emoji:'🐺',title:'Independent Thinker',description:'You value independence and make decisions with clear logic. You prefer deep bonds with a select few over a wide social circle.',strengths:['Self-reliant','Analytical','Calm under pressure','Fiercely loyal'],growthAreas:['Expressing vulnerability','Accepting help from others','Compromising in partnerships','Sharing feelings before being asked'],communicationStyle:'Direct and efficient. You say what you mean and expect the same.',conflictStyle:'You stay calm and logical but can seem cold. You need space to process before discussing.',idealDates:['Hiking a challenging trail together','Home-cooked dinner with no phones','Stargazing in a remote location'],loveLanguageFit:'Acts of Service & Quality Time',relationship:{whatYouBring:['Complete reliability — if you say you will be there, you will be there','Loyalty that is rare and completely unconditional','Strength that partners can genuinely lean on','A love that is never performative — every gesture is real'],whatYouNeed:['A partner who respects your need for autonomy without making it a conflict','Someone who does not interpret your silence as rejection','Space to come to people on your own terms','A partner secure enough in themselves not to need constant reassurance from you'],greenFlags:['They have a rich independent life of their own','They do not need to be with you every moment','They understand that your actions speak louder than your words','They give you space without making you feel guilty for needing it'],redFlags:['They interpret your independence as emotional unavailability','They need constant verbal affirmation you do not naturally give','They crowd your space physically or emotionally','They take your privacy personally'],howYouLove:'Through showing up. Through doing. Through a quiet, unshakeable constancy that may be the most reliable love your partner has ever received.',commonChallenge:'The people who love you most may not feel loved — not because you do not love them, but because you have not found a way to express it that lands for them.',reflectionPrompt:'What would it feel like to let someone close enough to actually see how much you care — even if that feels uncomfortably vulnerable?'}},
  LHLLH:{code:'LHLLH',name:'The Craftsman',emoji:'⚒️',title:'Methodical Achiever',description:'Structured, independent, and quietly driven. You do not just dream — you build, step by step, with standards most people do not reach.',strengths:['Disciplined','Skilled','Patient','Principled'],growthAreas:['Loosening standards for yourself and others','Celebrating progress not just completion','Sharing your process, not just the result','Allowing spontaneity'],communicationStyle:'Precise and practical. You communicate through demonstration more than words.',conflictStyle:'You solve problems, not process feelings. You can seem unmoved during emotional conflict.',idealDates:['Building or making something together','A masterclass in something you both want to learn','Exploring a city with a specific mission or goal'],loveLanguageFit:'Acts of Service & Quality Time',relationship:{whatYouBring:['A rare combination of reliability and quiet excellence','The kind of love that builds a life, not just a feeling','Pride in the relationship — you invest in making it genuinely good','Stability and competence that creates real security'],whatYouNeed:['A partner who appreciates what you build, not just what you say','Respect for the standards you hold — they come from care, not rigidity','Practical partnership — you love building things together','Someone who pulls their weight without being asked'],greenFlags:['They respect your process and your standards','They notice what you do without needing you to announce it','They have their own craft or discipline they take seriously','They are dependable and consistent'],redFlags:['They are chaotic and resist structure','They need constant verbal expression of love you may not give naturally','They confuse your high standards with criticism','They do not follow through on their commitments'],howYouLove:'By building something real. By maintaining it. By making sure everything around the people you love works, holds, and lasts.',commonChallenge:'You invest so much in building the structure of love that the feeling inside it can get neglected. Your partner needs to feel the warmth, not just the framework.',reflectionPrompt:'What would happen if you applied the same care you give your work to telling the people you love how you feel about them?'}},
  LHLHL:{code:'LHLHL',name:'The Protector',emoji:'🛡️',title:'Loyal Guardian',description:'Structured, caring, and deeply loyal. You create safety for those you love and protect them with quiet, unwavering strength.',strengths:['Dependable','Nurturing','Organised','Protective'],growthAreas:['Letting others take care of you','Not over-controlling situations','Expressing your own needs','Accepting imperfection'],communicationStyle:'Steady and reassuring. You listen patiently and respond thoughtfully.',conflictStyle:'You stay calm and try to mediate. You may suppress your own frustration to keep the peace.',idealDates:['Home-cooked meal planned together','Farmer\'s market followed by cooking together','Nature walk with deep conversation'],loveLanguageFit:'Acts of Service & Physical Touch',relationship:{whatYouBring:['A love that is truly safe — consistent, warm, and completely reliable','The kind of stability most people spend their whole lives looking for','Practical care — you anticipate needs before they are expressed','A presence that makes people feel genuinely protected'],whatYouNeed:['A partner who recognises that you need care too, not just give it','Room to not always be the strong one','Appreciation for the invisible labour of keeping everything running','Someone who communicates their needs clearly — you carry enough without guessing'],greenFlags:['They notice and appreciate what you do','They check in on YOU without you having to ask','They are emotionally available and do not need rescuing','They have their own strength so you can rest sometimes'],redFlags:['They take your consistency for granted','They always need saving but never offer support back','They mistake your nurturing for weakness','They resist your structure instead of working with it'],howYouLove:'By showing up. Every single time. By making sure the person you love never has to wonder if you will be there.',commonChallenge:'You give so much that you may not notice your own needs until they are urgent. Learning to receive care with as much grace as you give it is the work.',reflectionPrompt:'When was the last time you let someone take care of you — really take care of you — without immediately finding a way to return the favour?'}},
  LHLHH:{code:'LHLHH',name:'The Nurturer',emoji:'🌷',title:'Caring Organiser',description:'You combine genuine warmth with thoughtful structure and a love of experience. You care deeply and show it through consistent, considerate action.',strengths:['Caring','Organised','Emotionally available','Supportive'],growthAreas:['Not over-giving at your own expense','Setting boundaries','Accepting you cannot fix everyone','Asking for what you need'],communicationStyle:'Warm and attentive. You check in regularly, remember details, and make people feel valued.',conflictStyle:'You address issues gently but directly. You want resolution and harmony.',idealDates:['Volunteering together followed by a cosy dinner','Baking something elaborate together','Planning a surprise care package for a friend — together'],loveLanguageFit:'Acts of Service & Gifts (thoughtful ones)',relationship:{whatYouBring:['A love that is organised AND warm — rare combination','The ability to make your partner feel genuinely looked after','A home and relationship that run with love AND efficiency','Thoughtful gestures that show you were thinking of them when they were not around'],whatYouNeed:['A partner who reciprocates your care — you cannot sustain one-way giving indefinitely','Recognition for what you do, not just what you say','Someone who is emotionally available, not just appreciative','Permission to not always be the caretaker'],greenFlags:['They notice the things you do before you have to point them out','They take care of you without being asked','They appreciate organisation rather than resisting it','They are emotionally open and do not make you work for connection'],redFlags:['They take your giving for granted and contribute nothing','They are emotionally distant or unavailable','They resist your nurturing as "too much"','They never reciprocate the effort you invest'],howYouLove:'Through consistent, considered care. The remembered preference. The thing you organised six weeks ago because you knew it would matter. The meal, the plan, the gesture.',commonChallenge:'You may give beyond your capacity because saying no feels like failing the people you love. But an empty cup cannot fill anyone else\'s.',reflectionPrompt:'What do YOU need in a relationship that you have never quite let yourself ask for?'}},
  LHHLL:{code:'LHHLL',name:'The Sage',emoji:'📚',title:'Wise Counsellor',description:'You combine emotional depth with structured thinking. People naturally come to you for wisdom, guidance, and a calm perspective.',strengths:['Wise','Emotionally intelligent','Patient','Balanced'],growthAreas:['Being less guarded with your own feelings','Taking risks','Being spontaneous sometimes','Not always being the "strong one"'],communicationStyle:'Thoughtful and balanced. You consider both logic and emotion before responding.',conflictStyle:'You mediate naturally, seeing both sides. The risk is prioritising fairness over expressing your own hurt.',idealDates:['Tea ceremony or mindfulness workshop','Deep conversation walk in botanical gardens','Book exchange and reading café'],loveLanguageFit:'Quality Time & Words of Affirmation',relationship:{whatYouBring:['Emotional maturity that creates a genuinely safe relationship','Wisdom — you help your partner understand themselves better','Balance: you hold both logic and feeling with equal skill','Depth of conversation most people never experience in a relationship'],whatYouNeed:['A partner who can meet you in depth — not just appreciate it from a distance','Someone who asks about YOUR feelings, not just receives your wisdom','Room to not have all the answers sometimes','Permission to be unbalanced occasionally'],greenFlags:['They are curious about your inner world, not just your advice','They are emotionally intelligent enough to hold their own','They challenge you thoughtfully instead of just agreeing','They check in on how you are, not just how you are handling things'],redFlags:['They come to you only for wisdom and never truly know you','They are emotionally dependent without doing their own work','They confuse your balance with not having needs','They never offer you the depth you offer them'],howYouLove:'With patience, perspective, and a rare kind of steadiness. You love people not just as they are but as they are becoming.',commonChallenge:'You may be so accustomed to being the wise one that being vulnerable feels like losing something important. Your partner needs your vulnerability, not just your wisdom.',reflectionPrompt:'What would it mean to let someone take care of you the way you take care of everyone else?'}},
  LHHLH:{code:'LHHLH',name:'The Romantic',emoji:'🌹',title:'Passionate Planner',description:'You combine structured thinking with deep emotion and a love of experience. You plan grand gestures, feel everything intensely, and pour your heart into love.',strengths:['Romantic','Thoughtful','Expressive','Dedicated'],growthAreas:['Not over-idealising partners','Handling unromantic realities','Being flexible when plans go wrong','Accepting imperfect love'],communicationStyle:'Emotionally rich and deliberate. You choose words carefully to express feelings.',conflictStyle:'Conflicts hurt you deeply because you invest so much. You may withdraw before returning with honesty.',idealDates:['Candlelit dinner you planned for weeks','Recreating your first date','Surprise scavenger hunt through meaningful locations'],loveLanguageFit:'Gifts (elaborate) & Words of Affirmation',relationship:{whatYouBring:['A love that is planned, intentional, and genuinely extraordinary','The ability to make your partner feel like the most thought-about person alive','Emotional richness AND practical follow-through — rare combination','Memories built with intention, not accident'],whatYouNeed:['A partner who appreciates grand gestures without feeling overwhelmed by them','Someone who reciprocates intentionality — they do not need to match you, but they need to try','Emotional depth — you cannot sustain a relationship that lives only on the surface','The occasional acknowledgement that your effort is noticed'],greenFlags:['They receive love gracefully and reciprocate in their own way','They appreciate the thought behind what you do','They are emotionally available and expressive','They value depth and meaning in a relationship'],redFlags:['They are uncomfortable with expressed emotion or big gestures','They are consistently unappreciative of your effort','They need emotional predictability you may struggle to provide','They idealise you back — you both need someone to stay real'],howYouLove:'With intention, creativity, and total commitment. Every anniversary remembered. Every meaningful date honoured. Every gesture chosen to say: you are worth this.',commonChallenge:'The relationship you plan in your mind can become a standard the real relationship cannot meet. The person in front of you is more interesting than the ideal anyway.',reflectionPrompt:'What would love look like if you stopped planning it and just felt it — exactly as it is, not as you imagined it?'}},
  LHHHH:{code:'LHHHH',name:'The Empath',emoji:'🫀',title:'Deeply Connected Soul',description:'Feeling-led, socially rich, and endlessly curious about people and experience. You move through the world with your heart fully open.',strengths:['Empathetic','Connected','Emotionally intelligent','Adventurous in feeling'],growthAreas:['Protecting your emotional energy','Not losing yourself in others','Maintaining your own identity in relationships','Setting boundaries from love, not fear'],communicationStyle:'Open, feeling-first, and deeply attentive. You absorb subtext that others miss.',conflictStyle:'You feel conflict physically. You need connection re-established before resolution, not after.',idealDates:['Long dinner with stories that go all night','Spontaneous adventure where something real happens','Anything that creates a shared memory you will both talk about years later'],loveLanguageFit:'Physical Touch & Words of Affirmation',relationship:{whatYouBring:['A love that is fully present and completely felt','The ability to make people feel genuinely known','Emotional generosity that transforms relationships','A depth of connection most people only read about'],whatYouNeed:['A partner who can receive your depth without being overwhelmed','Emotional reciprocity — not just appreciation, but genuine giving back','Space to feel without being told how to feel','Someone emotionally intelligent enough to truly see you'],greenFlags:['They are emotionally mature and do not need you to manage their feelings','They appreciate your depth without weaponising it','They are adventurous enough to go where you want to go emotionally','They see your empathy as a strength'],redFlags:['They are emotionally unavailable but enjoy what your empathy gives them','They take more than they give, consistently','They make you feel "too much" or "too intense"','They cannot handle emotional complexity'],howYouLove:'With everything. And that is both your greatest gift and the thing you will need to protect most carefully.',commonChallenge:'You may give your empathy so freely that people learn to take it without offering anything back. Discernment about who deserves that access is not coldness — it is self-respect.',reflectionPrompt:'Who in your life truly fills you back up — and are you giving them as much access as the people who drain you?'}},
  HLLLL:{code:'HLLLL',name:'The Maverick',emoji:'⚡',title:'Bold Individualist',description:'Outgoing and logical, you march to your own beat. You light up rooms while staying fiercely true to yourself.',strengths:['Charismatic','Independent-minded','Bold','Direct'],growthAreas:['Listening to others\' emotions','Slowing down for quieter partners','Admitting when you are wrong','Being vulnerable'],communicationStyle:'Direct and energetic. You say exactly what you think, which is refreshing — but can lack tact.',conflictStyle:'You confront issues head-on, immediately. You want fast resolution.',idealDates:['Rock climbing or go-karting','Stand-up comedy show','Spontaneous road trip to somewhere neither of you has been'],loveLanguageFit:'Physical Touch & Quality Time',relationship:{whatYouBring:['Energy and honesty that cuts through pretence','Excitement — life with you is rarely boring','The confidence to go after what you want in love, not just hope for it','A direct love that your partner never has to decode'],whatYouNeed:['A partner who can match your pace without being diminished by it','Someone secure enough not to be threatened by your independence','Directness back — you cannot operate in a relationship of hints and subtext','Room to be yourself without constant softening'],greenFlags:['They are confident and secure in themselves','They appreciate honesty even when it is uncomfortable','They have their own strong identity','They do not need you to be someone else'],redFlags:['They need constant emotional management','They take your directness as aggression','They are passive-aggressive rather than honest','They try to dim your energy to feel more comfortable'],howYouLove:'Boldly and honestly. You pursue, you commit, and when you are in — you are fully in. Your partner always knows where they stand.',commonChallenge:'Your pace and directness can leave quieter partners feeling steamrolled. Slowing down is not weakness — it is how you reach people who process differently.',reflectionPrompt:'What would it feel like to let someone else lead — not because you cannot, but because you trust them enough to?'}},
  HLLLH:{code:'HLLLH',name:'The Dynamo',emoji:'🔥',title:'Energetic Trailblazer',description:'Outgoing, logical, and hungry for new experience. You move fast, think clearly, and leave an impression everywhere you go.',strengths:['Energetic','Sharp','Bold','Adaptable'],growthAreas:['Staying when things get hard','Emotional availability','Depth over novelty in relationships','Processing before reacting'],communicationStyle:'Fast, direct, and idea-rich. You generate energy in every conversation.',conflictStyle:'You want resolution now. You may move on before your partner has finished processing.',idealDates:['Spontaneous city adventure with no plan','Competitive activity that ends in good conversation','Something neither of you has done before'],loveLanguageFit:'Quality Time & Physical Touch',relationship:{whatYouBring:['Excitement and momentum — life with you accelerates','A love that is direct and clear — no confusion about your intent','The energy to pursue experiences that create real shared memories','Confidence that is genuinely attractive'],whatYouNeed:['A partner who keeps up without burning out','Novelty — not necessarily new people, but new experiences with the same person','Directness and clarity — you do not have time for emotional games','Someone who is excited about life, not just comfortable in it'],greenFlags:['They are energetic and up for things','They are direct and honest','They have their own ambitions and are not just along for your ride','They can slow you down without stopping you'],redFlags:['They need constant routine and resist change','They are conflict-avoidant and bury things','They cannot match your pace and resent you for it','They mistake your energy for shallowness'],howYouLove:'Fast, full, and experientially. You show love by doing — by creating adventures, by showing up fully, by making the person you love feel like the world just got bigger.',commonChallenge:'The same energy that attracts people can make them feel like they are competing with life itself for your attention. Presence, not just activity, is what sustains love.',reflectionPrompt:'What would it mean to stay — not because you have to, but because something is worth going deep with?'}},
  HLLHL:{code:'HLLHL',name:'The Social Butterfly',emoji:'🦋',title:'Life of the Party',description:'Outgoing, spontaneous, and people-loving. You thrive on connection, make friends everywhere, and bring joy to every gathering.',strengths:['Social','Adaptable','Fun-loving','Connector'],growthAreas:['Deepening relationships beyond surface level','Being comfortable alone','Following through on commitments','Having difficult conversations'],communicationStyle:'Warm, frequent, and enthusiastic. You love constant connection.',conflictStyle:'You avoid heavy conflict and try to lighten the mood.',idealDates:['Lively food market hopping','Group double date with friends','Dance class or karaoke night'],loveLanguageFit:'Physical Touch & Words of Affirmation',relationship:{whatYouBring:['Joy — you genuinely make people feel good to be around','A social world that expands your partner\'s life','Warmth that people gravitate toward','The ability to make any moment feel like a celebration'],whatYouNeed:['A partner who enjoys your social world rather than resenting it','Freedom to maintain your friendships without guilt','Light and fun alongside depth — you cannot live in heaviness','Someone who matches your warmth, even if not your pace'],greenFlags:['They enjoy people and are socially comfortable','They celebrate you rather than compete with you','They are secure enough to let you shine','They bring depth to balance your breadth'],redFlags:['They are jealous of your social energy','They need you to themselves and resent your friends','They mistake your openness for superficiality','They cannot have fun — everything is serious'],howYouLove:'With enthusiasm, warmth, and presence. You make your partner feel like the most important person in any room — when you remember to make them feel that specifically.',commonChallenge:'The same warmth you give everyone can make your partner wonder what makes them special. Specificity is everything — let them know, clearly, what is theirs alone.',reflectionPrompt:'What would a relationship look like that had both the joy you need AND the depth that makes it last?'}},
  HLLHH:{code:'HLLHH',name:'The Explorer',emoji:'🌍',title:'Passionate Adventurer',description:'Outgoing, spontaneous, and endlessly curious. You love people and experience in equal measure, and you move through life like every chapter could be the best one.',strengths:['Adventurous','Sociable','Optimistic','Energetic'],growthAreas:['Commitment when novelty fades','Patience with slower-paced partners','Finishing what you start','Finding meaning in the ordinary'],communicationStyle:'Enthusiastic and story-rich. You communicate through experience.',conflictStyle:'You prefer to move forward rather than dwell. You may resolve conflict by changing the subject rather than resolving the feeling.',idealDates:['Weekend trip planned in 24 hours','Street food in a neighbourhood you\'ve never visited','Anything that creates a story worth telling'],loveLanguageFit:'Quality Time (adventurous) & Physical Touch',relationship:{whatYouBring:['A relationship that is alive — never stagnant','Optimism that genuinely carries people through hard patches','The ability to make your partner feel like life just got bigger','Social richness and a world full of interesting people'],whatYouNeed:['A partner who is excited about life, not just comfortable in it','Freedom to move without feeling anchored by resentment','Someone who creates adventure WITH you, not watches you have it','Novelty in the relationship — not just outside it'],greenFlags:['They are up for things — genuinely, not reluctantly','They are secure enough not to need you home every night','They bring their own energy rather than borrowing yours','They can anchor you without stopping you'],redFlags:['They need complete routine and resist every new thing','They are jealous of your social energy','They slow down your life and resent you for feeling stifled','They mistake your optimism for naivety'],howYouLove:'By including your partner in everything wonderful. By making them feel like the adventure you chose — not the anchor that slows the others down.',commonChallenge:'You can outrun the depth a relationship needs. Novelty is the beginning of love, not the whole of it. What is left when the adventure is ordinary?',reflectionPrompt:'What would it feel like to discover that the person you are already with is the most interesting adventure you have ever been on?'}},
  HLHLL:{code:'HLHLL',name:'The Inspirer',emoji:'✨',title:'Charismatic Leader',description:'You light up every room with warmth, energy, and genuine care. People are drawn to your enthusiasm and emotional openness.',strengths:['Inspiring','Warm','Energetic','Motivating'],growthAreas:['Listening more than talking','Accepting not everyone shares your energy','Handling criticism gracefully','Following through on all your ideas'],communicationStyle:'Enthusiastic and emotional. You lead with energy and feeling.',conflictStyle:'You want to talk it out immediately and passionately.',idealDates:['Surprise rooftop dinner you planned','Live music festival','Couples cooking class with a social vibe'],loveLanguageFit:'Words of Affirmation & Gifts (grand gestures)',relationship:{whatYouBring:['Inspiration — your partner becomes a better version of themselves around you','Warmth that makes home feel like the best place to be','Emotional availability and genuine enthusiasm for love','The energy to make relationships feel like they are always growing'],whatYouNeed:['A partner who receives your energy rather than managing it','Emotional reciprocity — you give so much and need it returned','Someone who appreciates expressiveness rather than being overwhelmed by it','Room to be enthusiastic without being told to dial it back'],greenFlags:['They receive your warmth without being passive about it','They match your emotional investment in their own way','They are inspired by you, not exhausted by you','They give honest feedback rather than just validation'],redFlags:['They are emotionally flat or unavailable','They take your enthusiasm for granted','They consistently choose logic over connection','They cannot slow down enough to feel what you are offering'],howYouLove:'Out loud. Fully. With no shortage of words, gestures, or genuine feeling. Your love is visible — and that is one of your rarest gifts.',commonChallenge:'Your ideas and enthusiasm can generate more starts than finishes. Your partner needs to trust that your love, unlike some of your projects, will be seen through.',reflectionPrompt:'What would it feel like to be loved with the same intensity you love with — and could you receive it, or would that feel like too much?'}},
  HLHLH:{code:'HLHLH',name:'The Adventurous Spirit',emoji:'🌋',title:'Passionate Explorer',description:'You combine outgoing energy with deep feeling and a hunger for adventure. You experience life intensely, love wholeheartedly, and chase every experience.',strengths:['Passionate','Expressive','Adventurous','Romantic'],growthAreas:['Staying committed when the "newness" fades','Being patient with slower-paced partners','Finishing what you start','Sitting with ordinary moments'],communicationStyle:'Passionate and expressive. You share feelings openly, sometimes dramatically.',conflictStyle:'You are emotionally intense during conflicts — big feelings, big expressions.',idealDates:['Hot air balloon ride at sunset','Street food crawl in a new neighbourhood','Midnight beach walk'],loveLanguageFit:'Physical Touch & Quality Time (adventurous)',relationship:{whatYouBring:['Passion that makes love feel like it is supposed to feel','Spontaneity that keeps the relationship from ever going stale','Emotional depth AND excitement — rare and extraordinary combination','A love that is fully felt and fully expressed'],whatYouNeed:['A partner who can match your intensity without being overwhelmed','Freedom to pursue adventures — ideally together','Emotional availability and reciprocity','Someone grounded enough to hold things steady when your feelings run high'],greenFlags:['They are emotionally available and expressive','They love adventure as much as you do, or at least support yours','They are grounded enough to balance your intensity','They find your passion exciting, not exhausting'],redFlags:['They are emotionally shut down or stoic','They need complete routine and resist adventure','They mistake your intensity for instability','They cannot match your pace and blame you for the gap'],howYouLove:'Completely and immediately. You love like the world might end — and that is exhilarating. The work is learning to love like the world will go on.',commonChallenge:'The intensity you bring can make ordinary moments feel inadequate. But the most enduring love lives in the ordinary — learning to feel that is the real adventure.',reflectionPrompt:'What would it mean to find the extraordinary in the person who is already here — not the next experience, but this one?'}},
  HLHHL:{code:'HLHHL',name:'The Champion',emoji:'🏆',title:'Passionate Leader',description:'Outgoing, structured, and deeply feeling. You lead with your heart but plan with your head. You champion the people you love.',strengths:['Passionate','Organised','Warm','Decisive'],growthAreas:['Accepting that others do things differently','Releasing control of outcomes','Not over-planning emotional moments','Listening before leading'],communicationStyle:'Warm and direct. You lead conversations as naturally as you lead everything else.',conflictStyle:'You engage immediately and emotionally, then pivot to solutions.',idealDates:['Elaborate surprise date with multiple stops you planned','Charity event you organised together','Cooking competition — just the two of you'],loveLanguageFit:'Acts of Service & Words of Affirmation',relationship:{whatYouBring:['Leadership in love — you take initiative and make things happen','Warmth AND organisation — you show love through both feeling and doing','The ability to make your partner feel championed in everything','Genuine investment in making the relationship excellent'],whatYouNeed:['A partner who appreciates being led without feeling controlled','Emotional engagement — you cannot sustain a love that stays on the surface','Someone who sees your organising as care, not control','Recognition that you work hard at love, not just at life'],greenFlags:['They appreciate your initiative','They are emotionally available and expressive','They have their own strong direction in life','They do not compete with you — they complement'],redFlags:['They are passive and resent your leadership without offering their own','They are emotionally flat or unavailable','They take your planning as controlling','They need to win every dynamic rather than share it'],howYouLove:'With total commitment and active investment. You do not just feel love — you build it, organise it, and champion it every day.',commonChallenge:'You lead so naturally that your partner may feel like a participant in your life rather than an equal architect of a shared one. The best partnerships are co-led.',reflectionPrompt:'What would it feel like to hand someone else the plan — and trust that what they build is just as good as what you would have made?'}},
  HLHHH:{code:'HLHHH',name:'The Connector',emoji:'🔗',title:'Community Builder',description:'Outgoing, feeling-led, and hungry for experience. You bring people together, create belonging, and move through the world with your whole heart open.',strengths:['Warm','Connected','Adventurous','Generous'],growthAreas:['Depth over breadth in relationships','Not spreading yourself too thin','Prioritising your own needs','Being comfortable with stillness'],communicationStyle:'Warm, expressive, and inclusive. You make everyone feel part of the conversation.',conflictStyle:'You want harmony restored quickly. You may seek outside perspective or mediation.',idealDates:['Dinner party you hosted together','Festival with a group of people you both love','Spontaneous trip that becomes a group adventure'],loveLanguageFit:'Quality Time & Physical Touch',relationship:{whatYouBring:['A love that includes — you make your partner feel part of something larger','Warmth that extends to everyone your partner cares about','Adventure AND connection — the two things that make life rich','A generosity of spirit that is genuinely rare'],whatYouNeed:['A partner who enjoys your world rather than competing with it','Someone social enough to share your life without feeling like a guest in it','Emotional depth alongside the breadth — you need real connection, not just contact','Freedom to maintain your many relationships without guilt'],greenFlags:['They embrace your social world with genuine enthusiasm','They have their own community they bring in','They are emotionally available for the deep conversations, not just the fun ones','They are secure enough to share you without feeling lost'],redFlags:['They are jealous of your time and friendships','They need you entirely to themselves','They cannot match your social energy and resent you for having it','They mistake breadth of connection for lack of depth'],howYouLove:'By including. By weaving your partner into your world until they cannot imagine their life without the fabric of it. By making them feel at home everywhere you go.',commonChallenge:'The same generosity that makes you extraordinary can dilute the specific, singular attention a partner needs to feel truly chosen. Being chosen is different from being included.',reflectionPrompt:'In a life full of people you love, what does it mean to make one person feel irreplaceable?'}},
  HHLLL:{code:'HHLLL',name:'The Commander',emoji:'👑',title:'Strategic Leader',description:'Outgoing, organised, and logical. You naturally take charge, set goals, and get things done with impressive efficiency.',strengths:['Leadership','Organised','Decisive','Goal-oriented'],growthAreas:['Letting others lead sometimes','Being emotionally present','Not treating relationships like projects','Showing vulnerability'],communicationStyle:'Clear, structured, and efficient. You run conversations like productive meetings.',conflictStyle:'You approach conflict as a problem to solve. Facts, solutions, quick resolution.',idealDates:['Competitive activity — bowling, mini golf, trivia','Strategy board game café','Well-planned city exploration with an itinerary'],loveLanguageFit:'Acts of Service & Quality Time (structured)',relationship:{whatYouBring:['Direction — you know where you are going and you bring your partner along','Reliability and organisation that creates genuine security','The ability to build a life, not just feel one','Clear communication — no ambiguity, no games'],whatYouNeed:['A partner who appreciates leadership rather than resenting it','Directness — you do not have time for subtext or hinting','Respect for your systems and goals','Someone with their own direction — you do not want to carry anyone'],greenFlags:['They are direct and honest','They have their own goals and drive','They appreciate structure rather than fighting it','They are emotionally available without being emotionally dependent'],redFlags:['They are passive and expect you to manage everything','They are passive-aggressive rather than direct','They take your efficiency as coldness','They compete with your leadership rather than complementing it'],howYouLove:'By building. By planning. By creating a structure within which love can be lived, not just felt. Your partner\'s life is measurably better because you are in it.',commonChallenge:'Relationships cannot be optimised. The moment you start treating your partner as a variable in a system is the moment they start to feel like one.',reflectionPrompt:'What would it feel like to not have a plan — to just be with someone, with no agenda, and let that be enough?'}},
  HHLLH:{code:'HHLLH',name:'The Strategist',emoji:'♟️',title:'Organised Trailblazer',description:'Outgoing, structured, logical, and always looking for the next horizon. You plan boldly and execute with precision.',strengths:['Strategic','Ambitious','Clear-headed','Energetic'],growthAreas:['Emotional availability','Slowing down for connection','Accepting that not all progress is measurable','Vulnerability'],communicationStyle:'Efficient and forward-looking. You communicate to move things forward.',conflictStyle:'You address it, resolve it, move on. Dwelling feels wasteful to you.',idealDates:['Planning something ambitious together — a trip, a project, a goal','High-intensity activity followed by a strategic debrief over dinner','Visiting somewhere that requires research and preparation'],loveLanguageFit:'Acts of Service & Quality Time',relationship:{whatYouBring:['Ambition that elevates the people around you','A love that is planned and executed, not just felt','The ability to build a future that is genuinely exciting','Clarity — your partner always knows where things stand'],whatYouNeed:['A partner who is growth-oriented and not threatened by your ambition','Directness — you need honesty, not diplomacy','Shared goals — the relationship needs to be going somewhere','Emotional engagement that does not slow you down'],greenFlags:['They are ambitious and have their own direction','They communicate directly','They appreciate your drive rather than competing with it','They are emotionally available without being emotionally demanding'],redFlags:['They have no goals of their own and live in yours','They are indirect and expect you to read between lines','They mistake your pace for not caring','They slow down your life without adding depth to it'],howYouLove:'By investing. By planning the future. By treating the relationship as something worth building properly — with the same care you give everything else you value.',commonChallenge:'Efficiency is not intimacy. The most important conversations in a relationship cannot be scheduled and the most important moments cannot be planned.',reflectionPrompt:'What would happen if you stopped optimising the relationship and just experienced it for a while?'}},
  HHLHL:{code:'HHLHL',name:'The Host',emoji:'🎪',title:'Organised People-Person',description:'Outgoing, structured, feeling-led, and deeply invested in the people around you. You create belonging wherever you go.',strengths:['Warm','Organised','Socially intelligent','Reliable'],growthAreas:['Prioritising depth over social breadth','Saying no without guilt','Your own needs alongside others\'','Accepting imperfect gatherings'],communicationStyle:'Warm, organised, and inclusive. You are the person who makes sure everyone is okay.',conflictStyle:'You seek harmony and may involve others in resolution. You feel conflict as a threat to the group.',idealDates:['Dinner party you planned together','Neighbourhood event you organised','A deeply planned gesture for someone you both love'],loveLanguageFit:'Acts of Service & Quality Time',relationship:{whatYouBring:['A love that is felt by everyone around you, not just your partner','The ability to build a shared life that feels like community','Warmth AND organisation — the relationship runs AND feels good','A partner who always feels hosted, never forgotten'],whatYouNeed:['A partner who appreciates what you build for others','Someone who reciprocates the care without being asked','Emotional depth alongside social richness','Recognition that hosting others is one of the ways you love'],greenFlags:['They value community and bring their own','They appreciate your organisational gifts','They take care of you in return for how you take care of everyone','They are emotionally available for the real conversations'],redFlags:['They are jealous of the energy you give others','They are socially anxious in ways that limit your world','They never reciprocate your effort','They mistake your hosting for performance'],howYouLove:'By creating a world together. A home that people want to come to. A relationship embedded in community. A love that has a table big enough for everyone.',commonChallenge:'Your partner needs to feel like they have a special seat at that table — not just a place in the crowd you care for. Specificity and privacy matter alongside community.',reflectionPrompt:'What does your partner get from you that nobody else does — and do they know that?'}},
  HHLHH:{code:'HHLHH',name:'The Visionary',emoji:'🌠',title:'Ambitious Connector',description:'You combine outgoing energy, structured thinking, emotional depth, social richness, and adventurous hunger. You build worlds and invite people into them.',strengths:['Visionary','Warm','Organised','Inspiring'],growthAreas:['Slowing down for intimacy','Not burning out','Accepting ordinary moments','Letting your partner lead'],communicationStyle:'Comprehensive and inspiring. You paint pictures with words and bring people along.',conflictStyle:'You tackle every angle — feelings, facts, impact, solution — all at once.',idealDates:['An elaborate experience you designed entirely for them','A trip that required months of planning','Anything that creates a story you will still be telling in ten years'],loveLanguageFit:'Words of Affirmation & Acts of Service',relationship:{whatYouBring:['A love that is vast — emotional, practical, social, and experiential','The ability to make your partner feel like the centre of a world you built for them','Ambition that makes shared goals feel genuinely achievable','Warmth and depth and adventure — all at once'],whatYouNeed:['A partner who can receive everything you give without collapsing under it','Someone with their own depth and direction','Emotional reciprocity at scale — you give enormously and need it returned','Room to build without being told to slow down'],greenFlags:['They are emotionally and socially strong','They have their own vision alongside yours','They receive your love without becoming passive','They challenge you rather than just admiring you'],redFlags:['They are overwhelmed by your scale','They become dependent on your energy rather than generating their own','They cannot match your depth across any of the dimensions you live in','They mistake your fullness for showing off'],howYouLove:'With everything you have — emotionally, practically, socially, experientially. The risk is your partner feels loved by the vision and not by the person.',commonChallenge:'At this scale, the relationship can become a project. Your partner needs to feel like the reason, not the recipient, of everything you build.',reflectionPrompt:'Strip away everything you have built and planned and created — who are you to the person you love, and is that enough?'}},
  HHHLL:{code:'HHHLL',name:'The Captain',emoji:'⚓',title:'Decisive People-Leader',description:'Outgoing, structured, emotionally present, and deeply socially invested. You lead people — not from authority, but from genuine care.',strengths:['Leadership','Emotionally intelligent','Organised','Trusted'],growthAreas:['Delegating emotional responsibility','Not carrying others\' weight','Accepting you cannot lead everything','Spontaneity'],communicationStyle:'Clear, warm, and directional. You lead with care and people follow willingly.',conflictStyle:'You take responsibility quickly, seek understanding, then move to resolution.',idealDates:['A meaningful adventure you planned with intention','Volunteering for something that matters to both of you','A dinner where the conversation changes something'],loveLanguageFit:'Acts of Service & Words of Affirmation',relationship:{whatYouBring:['Leadership that feels like love, not control','Emotional availability AND practical strength — rare','A partner who your person is proud to stand beside','Consistency and warmth in equal measure'],whatYouNeed:['A partner who can lead alongside you — not follow, not compete','Emotional maturity — you do not want to manage anyone\'s growth','Respect for your structure and direction','Someone who can hold the emotional weight alongside you, not just receive your support'],greenFlags:['They are emotionally mature and self-aware','They have their own leadership capacity','They do not need to be managed','They appreciate your warmth AND your direction'],redFlags:['They are emotionally dependent and resist growth','They compete with your leadership destructively','They take your emotional availability for granted','They cannot operate without your direction'],howYouLove:'By leading with love. By being the person your partner turns to — not because they have to, but because they know you will not drop what you are carrying.',commonChallenge:'The same strength that makes you an extraordinary partner can attract people who need carrying. The relationship you deserve has two people standing.',reflectionPrompt:'What would it feel like to be with someone who needs nothing from your strength — and wants everything from your heart?'}},
  HHHLH:{code:'HHHLH',name:'The Catalyst',emoji:'💥',title:'Transformative Force',description:'Every dimension high except comfort-seeking. You are the person who changes the rooms, relationships, and lives you enter.',strengths:['Transformative','Emotionally rich','Organised','Adventurous'],growthAreas:['Sustaining what you start','Accepting that not everything needs changing','Stillness','Letting things be good without making them better'],communicationStyle:'Rich, multi-layered, and catalytic. Conversations with you leave people changed.',conflictStyle:'You engage with full emotional and analytical power. Conflicts become growth opportunities — sometimes whether the other person is ready or not.',idealDates:['A trip to somewhere that requires courage','An experience that changes one or both of you','Something neither of you can plan completely'],loveLanguageFit:'Quality Time & Words of Affirmation',relationship:{whatYouBring:['Transformation — people grow in relationship with you','The full spectrum of love: emotional, practical, social, experiential','A relationship that never stagnates','The rare experience of being truly known AND truly challenged'],whatYouNeed:['A partner strong enough to be changed without being broken','Someone who wants to grow, not just be comfortable','Emotional depth AND adventure AND structure — you need all of it','A partner who can match at least some of your dimensions without faking the rest'],greenFlags:['They are growth-oriented and self-aware','They are secure enough to be challenged','They bring dimensions you do not have','They do not need you to stop being what you are'],redFlags:['They want comfort above growth','They are threatened by your intensity','They cannot keep up and blame you for the pace','They need you to be smaller so they feel bigger'],howYouLove:'Fully and transformatively. People are different — genuinely different — for having been loved by you. That is extraordinary. Guard it.',commonChallenge:'Not every relationship needs to be a crucible. Some people need to be loved as they are, not transformed into who they could be. Learning the difference is the work.',reflectionPrompt:'What would it feel like to love someone with no agenda for who they might become — just complete acceptance of who they already are?'}},
  HHHHL:{code:'HHHHL',name:'The Luminary',emoji:'💫',title:'Radiant Leader',description:'Outgoing, structured, emotionally rich, deeply connected — and grounded in comfort and consistency. You radiate warmth and lead with extraordinary wholeness.',strengths:['Radiant','Grounded','Emotionally intelligent','Inspiring'],growthAreas:['Protecting your energy','Accepting that not everyone can receive what you give','Stillness and solitude','Not over-giving'],communicationStyle:'Warm, eloquent, and deeply considered. You communicate with the full weight of your personality.',conflictStyle:'You bring emotional intelligence, structure, and genuine care to every conflict. You almost always find resolution.',idealDates:['A deeply meaningful evening you curated entirely','A community event that reflects your shared values','Something that is simultaneously beautiful and useful'],loveLanguageFit:'Words of Affirmation & Acts of Service',relationship:{whatYouBring:['A love that covers every dimension — warm, structured, emotionally available, socially rich','The experience of being completely and consistently loved','A partner who makes your life genuinely better in measurable and immeasurable ways','Groundedness that makes your partner feel safe to be their fullest self'],whatYouNeed:['A partner who can receive this much love without being overwhelmed','Someone emotionally mature enough not to become dependent','Reciprocity — not at your scale, but genuine','Room to be imperfect sometimes — being this full is exhausting'],greenFlags:['They are secure and emotionally mature','They bring their own wholeness to the relationship','They reciprocate genuinely','They allow you to have off days without taking it personally'],redFlags:['They become passive in the warmth you create','They cannot match any dimension and do not try','They take your groundedness for granted','They confuse your consistency with unlimited availability'],howYouLove:'With a fullness that is genuinely rare. Your partner is lucky — and the luckiest thing would be if they knew it.',commonChallenge:'Being this much can attract people who need this much — and that is not the same as deserving it. You need a partner who matches you, not one who needs you.',reflectionPrompt:'What would it feel like to be loved with the same completeness you offer — and have you let yourself want that?'}},
  HHHHH:{code:'HHHHH',name:'The All-In',emoji:'🌈',title:'Complete Dynamo',description:'Every dimension at full expression. You are outgoing, organised, emotionally rich, deeply connected, and always seeking the next horizon. You are a lot — in the best possible way.',strengths:['Versatile','Emotionally intelligent','Social','Ambitious'],growthAreas:['Slowing down','Not burning out','Accepting you cannot be everything to everyone','Finding peace in stillness'],communicationStyle:'Comprehensive and dynamic. You switch between logical analysis, emotional sharing, and social coordination with ease.',conflictStyle:'You tackle every angle — facts, feelings, outside perspectives, future impact. Sometimes all at once.',idealDates:['Elaborate surprise with multiple planned stops','Weekend festival with people you both love','International trip planned together from scratch'],loveLanguageFit:'All five — you give and receive love in every language',relationship:{whatYouBring:['Everything. Warmth, structure, emotion, connection, adventure — simultaneously','A love that is genuinely comprehensive','The experience of being loved across every dimension at once','A relationship that never has a dull season'],whatYouNeed:['A partner who can receive the full weight of you without crumbling or becoming passive','Someone with real depth across multiple dimensions','Genuine reciprocity — you give at such scale that one-sided relationships hollow you out','Permission to be less than everything sometimes'],greenFlags:['They bring their own fullness','They are secure and do not need to be carried','They reciprocate genuinely across multiple dimensions','They tell you when it is too much — because someone should'],redFlags:['They become entirely defined by your relationship','They cannot keep up and resent you for it','They need you to be smaller so the relationship feels manageable to them','They mistake your fullness for showing off'],howYouLove:'At full volume, across every channel, in every love language, all the time. It is extraordinary. It is also a lot. Find someone who calls it a gift, not a burden.',commonChallenge:'You may expect the same total investment from others that you give — and that is a standard most people cannot meet. The partner you need is not the one who matches every dimension, but the one who is genuinely present in the ones that matter most.',reflectionPrompt:'What would it feel like to let yourself be loved imperfectly — not completely, not across every dimension — and find that it is still enough?'}},
});

const DEFAULT_ARCHETYPE:Archetype=ARCHETYPES['LLLLL']!;

/* ═══ DEV VALIDATION ═══ */
if(__DEV__){
  const expected=Array.from({length:32},(_,i)=>i.toString(2).padStart(5,'0').replace(/0/g,'L').replace(/1/g,'H'));
  if (__DEV__) for(const code of expected){if(!ARCHETYPES[code])console.warn(`[PersonalityQuiz] Missing archetype: ${code}`);}
  for(const[code,arch]of Object.entries(ARCHETYPES)){
    if (__DEV__) if(arch.code!==code)console.error(`[PersonalityQuiz] Code mismatch: key="${code}" arch.code="${arch.code}"`);
    if (__DEV__) if(arch.strengths.length<3)console.warn(`[PersonalityQuiz] ${code}: <3 strengths`);
    if (__DEV__) if(arch.idealDates.length<2)console.warn(`[PersonalityQuiz] ${code}: <2 ideal dates`);
    if (__DEV__) if(arch.relationship.greenFlags.length<3)console.warn(`[PersonalityQuiz] ${code}: <3 green flags`);
    if (__DEV__) if(arch.relationship.redFlags.length<3)console.warn(`[PersonalityQuiz] ${code}: <3 red flags`);
  }
}

/* ═══ SCORING ═══ */
function computeConsistency(scores:number[]):number{
  if(scores.length<2)return 100;
  const avg=scores.reduce((a,b)=>a+b,0)/scores.length;
  const variance=scores.reduce((sum,s)=>sum+(s-avg)**2,0)/scores.length;
  return Math.round(Math.max(0,100-(Math.sqrt(variance)/50)*100));
}
function getTraitLabel(trait:TraitDef,score:number):string{
  if(score<=THRESH_STRONG_LOW)return trait.lowLabel;
  if(score<=THRESH_LEAN_LOW)  return `Leaning ${trait.lowLabel}`;
  if(score<THRESH_LEAN_HIGH)  return 'Balanced';
  if(score<THRESH_STRONG_HIGH)return `Leaning ${trait.highLabel}`;
  return trait.highLabel;
}
function getTraitCode(score:number):'H'|'L'{return score>=THRESH_LEAN_HIGH?'H':'L';}
function generateSummary(traits:TraitScore[],archetype:Archetype,adventureScore:number):string{
  const get=(key:TraitKey)=>traits.find(t=>t.key===key)!;
  const e=get('energy'),p=get('planning'),em=get('emotion'),s=get('social');
  const energy  =e.score >60?'draw energy from being around others'  :e.score <40?'recharge in solitude and quiet'           :'balance social time with alone time';
  const planning=p.score >60?'prefer structure and clear plans'       :p.score <40?'thrive on spontaneity and flexibility'     :'adapt between planning and going with the flow';
  const emotion =em.score>60?'lead with your heart and feelings'      :em.score<40?'make decisions with logic and analysis'    :'balance logic and emotion in your choices';
  const social  =s.score >60?'build deep, wide social connections'    :s.score <40?'value your independence and personal space':'balance closeness with personal boundaries';
  const adv=adventureScore>60?'You are always chasing the next experience.':adventureScore<40?'You find comfort and meaning in familiar routines.':'You enjoy new experiences but also value your comfort zone.';
  return `You ${energy} and ${planning}. When faced with decisions, you ${emotion}. In relationships, you ${social}. ${adv} As ${archetype.name}, your greatest gifts are ${archetype.strengths.slice(0,2).join(' and ').toLowerCase()}.`;
}
function computeResults(answers:ReadonlyMap<number,AnswerScore>,totalTimeMs:number,questionTimesMs:readonly number[]):QuizResults{
  const accum=new Map<TraitKey,{weightedSum:number;totalWeight:number;scores:number[]}>();
  for(const key of TRAIT_KEYS)accum.set(key,{weightedSum:0,totalWeight:0,scores:[]});
  for(const q of QUESTIONS){
    const score=answers.get(q.id);
    if(score!==undefined){const entry=accum.get(q.trait)!;entry.weightedSum+=score*q.weight;entry.totalWeight+=q.weight;entry.scores.push(score);}
  }
  const traits:TraitScore[]=TRAIT_KEYS.map(key=>{
    const{weightedSum,totalWeight,scores}=accum.get(key)!;
    const score=totalWeight>0?Math.round(weightedSum/totalWeight):SCORE_NEUTRAL;
    return{key,score,label:getTraitLabel(TRAIT_MAP[key]!,score),consistency:computeConsistency(scores)};
  });
  const code=traits.map(t=>getTraitCode(t.score)).join('');
  const archetype=ARCHETYPES[code]??DEFAULT_ARCHETYPE;
  const adventureScore=traits.find(t=>t.key==='adventure')?.score??SCORE_NEUTRAL;
  const overallConsistency=Math.round(traits.reduce((sum,t)=>sum+t.consistency,0)/traits.length);
  const rawAnswers:Record<number,AnswerScore>={};
  answers.forEach((v,k)=>{rawAnswers[k]=v;});
  return{archetype,archetypeCode:code,traits,adventureScore,overallConsistency,summary:generateSummary(traits,archetype,adventureScore),quizVersion:QUIZ_VERSION,completedAt:new Date().toISOString(),totalTimeMs,questionTimesMs:[...questionTimesMs],rawAnswers};
}

/* ═══ STATE REDUCER ═══ */
type AnswerAction=|{type:'SET';questionId:number;score:AnswerScore}|{type:'LOAD';answers:Record<number,AnswerScore>}|{type:'RESET'};
function answersReducer(state:Map<number,AnswerScore>,action:AnswerAction):Map<number,AnswerScore>{
  switch(action.type){
    case'SET':{const next=new Map(state);next.set(action.questionId,action.score);return next;}
    case'LOAD':return new Map(Object.entries(action.answers).map(([k,v])=>[Number(k),v]));
    case'RESET':return state.size===0?state:new Map();
    default:return state;
  }
}

/* ═══ ANALYTICS ═══ */
function trackEvent(event:'start'|'complete'|'skip'|'abandon',timeMs?:number):void{
  try{
    const raw=appStorage.getString(ANALYTICS_KEY);
    const data=raw?JSON.parse(raw) as{started:number;completed:number;skipped:number;abandoned:number;avgTimeMs:number}:{started:0,completed:0,skipped:0,abandoned:0,avgTimeMs:0};
    if(event==='start')data.started++;
    else if(event==='complete'){data.completed++;if(timeMs)data.avgTimeMs=Math.round((data.avgTimeMs*(data.completed-1)+timeMs)/data.completed);}
    else if(event==='skip')data.skipped++;
    else data.abandoned++;
    appStorage.set(ANALYTICS_KEY,JSON.stringify(data));
  }catch{}
}

/* ═══ SCREEN WIDTH HOOK ═══ */
function useScreenWidth():number{
  const[width,setWidth]=useState(()=>Dimensions.get('window').width);
  useEffect(()=>{
  // FIXME: add removeEventListener cleanup for the listener below
    const sub=Dimensions.addEventListener('change',({window}, [])=>setWidth(window.width));
    return()=>sub.remove();
  },[]);
  return width;
}

/* ═══ ERROR BOUNDARY ═══ */
class QuizErrorBoundary extends React.Component<{children:React.ReactNode;onReset:()=>void},{hasError:boolean;error:Error|null}>{
  state={hasError:false,error:null as Error|null};
  static getDerivedStateFromError(error:Error){return{hasError:true,error};}
  render(){
    if(this.state.hasError)return(
      <SafeAreaView style={st.centered}>
        <Text style={{fontSize:50,marginBottom:16}}>😵</Text>
        <Text style={st.errTitle}>Something went wrong</Text>
        <Text style={st.errMsg}>{this.state.error?.message??'Unknown error'}</Text>
        <TouchableOpacity style={st.errBtn} onPress={()= accessibilityLabel="button">{this.setState({hasError:false,error:null});this.props.onReset();}} accessibilityLabel="Try again" accessibilityRole="button">
          <Text style={st.errBtnText}>Try Again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
    return this.props.children;
  }
}

/* ═══ SUB-COMPONENTS ═══ */

const TraitBar=React.memo(function TraitBar({trait,def,index}:{trait:TraitScore;def:TraitDef;index:number}){
  const progress=useSharedValue(0);
  const opacity =useSharedValue(0);

  useEffect(()=>{
    const delayMs=index*BAR_DELAY_MS;
    const id=setTimeout(()=>{
      progress.value=withTiming(trait.score,{duration:BAR_ANIM_MS}, []);
      opacity.value =withTiming(1,{duration:BAR_ANIM_MS/2});
    },delayMs);
    return()=>{
      clearTimeout(id);
      cancelAnimation(progress);
      cancelAnimation(opacity);
    };
  },[trait.score,index,progress,opacity]);

  const containerStyle=useAnimatedStyle(()=>({opacity:opacity.value}));
  const fillStyle     =useAnimatedStyle(()=>({width:`${progress.value}%` as `${number}%`}));
  const dotStyle      =useAnimatedStyle(()=>({left:`${progress.value}%` as `${number}%`}));

  return(
    <Animated.View style={[st.trRow,containerStyle]} accessible accessibilityLabel={`${def.name}: ${trait.label}, ${trait.score}%`}>
      <View style={st.trLabels}>
        <Text style={st.trLow}>{def.lowEmoji} {def.lowLabel}</Text>
        <Text style={st.trHigh}>{def.highLabel} {def.highEmoji}</Text>
      </View>
      <View style={st.trBarBg}>
        <Animated.View style={[st.trBarFill,{backgroundColor:def.color},fillStyle]}/>
        <Animated.View style={[st.trDot,{backgroundColor:def.color},dotStyle]}/>
      </View>
      <View style={st.trBottom}>
        <Text style={[st.trLabel,{color:def.color}]}>{trait.label} ({trait.score}%)</Text>
        <Text style={st.trConsist}>{trait.consistency>=80?'🎯':trait.consistency>=60?'🔄':'🤷'} {trait.consistency}%</Text>
      </View>
    </Animated.View>
  );
});

const AnswerButton=React.memo(function AnswerButton({option,question,traitColor,isSelected,onAnswer,disabled}:{option:AnswerOption;question:QuizQuestion;traitColor:string;isSelected:boolean;onAnswer:(score:AnswerScore)=>void;disabled:boolean}){
  const handlePress=useCallback(()=>onAnswer(option.score),[onAnswer,option.score]);
  const isMiddle=option.side==='neutral';
  const displayLabel=isMiddle?'It Depends':(option.id===0||option.id===4)?'Strongly':'Somewhat';
  const accessibilityLabel=isMiddle?'Neither — it depends on the situation':option.side==='A'?`${displayLabel} agree: ${question.sideA}`:`${displayLabel} agree: ${question.sideB}`;
  return(
    <TouchableOpacity style={[st.optBtn,isSelected&&st.optBtnSel,isMiddle&&st.optBtnMid,isSelected&&{borderColor:traitColor}]} onPress={handlePress} activeOpacity={0.7} disabled={disabled} accessibilityLabel={accessibilityLabel} accessibilityRole="radio" accessibilityState={{checked:isSelected,disabled}}>
      <Text style={st.optEmoji}>{option.emoji}</Text>
      <Text style={[st.optLabel,isSelected&&st.optLabelSel,isMiddle&&st.optLabelMid]} numberOfLines={2}>{displayLabel}</Text>
    </TouchableOpacity>
  );
});

const ProgressDots=React.memo(function ProgressDots({total,current,answeredCount}:{total:number;current:number;answeredCount:number}){
  return(
    <View style={st.dotsRow} accessibilityLabel={`Question ${current+1} of ${total}`} accessibilityRole="progressbar">
      {Array.from({length:total},(_,i)=>(
        <View key={i} style={[st.dot,i<answeredCount&&st.dotDone,i===current&&st.dotCur]}/>
      ))}
    </View>
  );
},(prev,next)=>prev.current===next.current&&prev.answeredCount===next.answeredCount);

const InsightScreen=React.memo(function InsightScreen({card,onContinue}:{card:InsightCard;onContinue:()=>void}){
  return(
    <View style={st.insightWrap}>
      <Text style={st.insightEmoji}>{card.emoji}</Text>
      <Text style={st.insightTitle}>{card.title}</Text>
      <Text style={st.insightBody}>{card.body}</Text>
      <TouchableOpacity style={st.insightBtn} onPress={onContinue} activeOpacity={0.8} accessibilityLabel="Continue to next question" accessibilityRole="button">
        <Text style={st.insightBtnText}>Continue →</Text>
      </TouchableOpacity>
    </View>
  );
});

const ChipList=React.memo(function ChipList({items}:{items:readonly string[]}){
  return(<View style={st.chipGrid}>{items.map(s=>(<View key={s} style={st.chip}><Text style={st.chipText}>{s}</Text></View>))}</View>);
});

const BulletList=React.memo(function BulletList({items,bullet='→',color=C.accent}:{items:readonly string[];bullet?:string;color?:string}){
  return(<>{items.map(item=>(<View key={item} style={st.bulletRow}><Text style={[st.bulletDot,{color}]}>{bullet}</Text><Text style={st.secBody}>{item}</Text></View>))}</>);
});

const DateList=React.memo(function DateList({items}:{items:readonly string[]}){
  return(<>{items.map((d,i)=>(<View key={i} style={st.dateRow}><Text style={st.dateNum}>{i+1}</Text><Text style={st.secBody}>{d}</Text></View>))}</>);
});

const CompatCard=React.memo(function CompatCard({code,arch,dynamic,isSelf,isExpanded,onToggle}:{code:string;arch:Archetype;dynamic:RelationshipDynamic;isSelf:boolean;isExpanded:boolean;onToggle:()=>void}){
  return(
    <View style={st.compatItem}>
      <TouchableOpacity style={[st.compatRow,isSelf&&st.compatRowSelf]} onPress={onToggle} activeOpacity={0.7} accessibilityLabel={`${arch.name}${isSelf?', your type':''}. ${dynamic.tagline}. Tap to ${isExpanded?'collapse':'expand'}.`} accessibilityRole="button" accessibilityState={{expanded:isExpanded}}>
        <Text style={st.compatEmoji}>{arch.emoji}</Text>
        <View style={st.compatInfo}><Text style={st.compatName}>{arch.name}{isSelf?' (You)':''}</Text><Text style={st.compatTagline}>{dynamic.tagline}</Text></View>
        <Text style={st.compatChevron}>{isExpanded?'▲':'▼'}</Text>
      </TouchableOpacity>
      {isExpanded&&(
        <View style={st.compatDetail}>
          <Text style={st.compatStrength}>✓ {dynamic.strength}</Text>
          <Text style={st.compatWatch}>△ {dynamic.watchOut}</Text>
          {dynamic.selfNote!=null&&<Text style={st.compatSelfNote}>{dynamic.selfNote}</Text>}
        </View>
      )}
    </View>
  );
});

function CompatibilityExplorer({userCode}:{userCode:string}){
  const[expanded,setExpanded]=useState<string|null>(null);
  const types=useMemo(()=>Object.entries(ARCHETYPES).map(([code,arch])=>({code,arch,dynamic:getRelationshipDynamic(userCode,code),isSelf:code===userCode})).sort((a,b)=>a.isSelf?-1:b.isSelf?1:0),[userCode]);
  const toggle=useCallback((code:string)=>{setExpanded(prev=>prev===code?null:code);},[]);
  return(
    <View style={st.secCard}>
      <Text style={st.secTitle}>🔍 How You Connect With Different Types</Text>
      <Text style={st.explorerDisclaimer}>These reflect general tendencies — not rules. You know who you connect with better than any algorithm does.</Text>
      {types.map(({code,arch,dynamic,isSelf})=>(<CompatCard key={code} code={code} arch={arch} dynamic={dynamic} isSelf={isSelf} isExpanded={expanded===code} onToggle={()=>toggle(code)}/>))}
    </View>
  );
}

/* ═══ MAIN COMPONENT ═══ */
function PersonalityQuizInner(){
  const router=useRouter();
  const{t}=useLanguage();
  const screenW=useScreenWidth();

  const[qIndex,        setQIndex]        =useState(0);
  const[answers,       dispatch]         =useReducer(answersReducer,new Map<number,AnswerScore>());
  const[submitting,    setSubmitting]    =useState(false);
  const[results,       setResults]       =useState<QuizResults|null>(null);
  const[showResults,   setShowResults]   =useState(false);
  const[showInsight,   setShowInsight]   =useState<InsightCard|null>(null);
  const[draftLoaded,   setDraftLoaded]   =useState(false);
  const[existingType,  setExistingType]  =useState<string|null>(null);
  const[waitingForNext,setWaitingForNext]=useState(false);
  const[showExplorer,  setShowExplorer]  =useState(false);

  const fadeAnim=useSharedValue(1);
  const fadeStyle=useAnimatedStyle(()=>({opacity:fadeAnim.value}));

  const timerRef    =useRef<ReturnType<typeof setTimeout>|null>(null);
  const mountedRef  =useRef(true);
  const startTime   =useRef(Date.now());
  const qStartTime  =useRef(Date.now());
  const qTimesRef   =useRef<number[]>([]);
  const answersRef  =useRef(answers);
  const qIndexRef   =useRef(qIndex);
  const handleAnswerRef=useRef<((score:AnswerScore)=>void)|null>(null);
  const handleBackRef  =useRef<(()=>void)|null>(null);
  const showResultsRef =useRef(showResults);
  const showInsightRef =useRef(showInsight);
  const submittingRef  =useRef(submitting);
  const waitingRef     =useRef(waitingForNext);

  useEffect(()=>{answersRef.current=answers;},[answers]);
  useEffect(()=>{qIndexRef.current=qIndex;},[qIndex]);
  useEffect(()=>{showResultsRef.current=showResults;},[showResults]);
  useEffect(()=>{showInsightRef.current=showInsight;},[showInsight]);
  useEffect(()=>{submittingRef.current=submitting;},[submitting]);
  useEffect(()=>{waitingRef.current=waitingForNext;},[waitingForNext]);

  const question      =useMemo(()=>QUESTIONS[qIndex]??QUESTIONS[0]!,[qIndex]);
  const progress      =((qIndex+1)/TOTAL_QUESTIONS)*100;
  const currentAnswer =answers.get(question.id);
  const canGoBack     =qIndex>0;
  const trait         =TRAIT_MAP[question.trait]??TRAITS[0]!;
  const buttonsDisabled=submitting||waitingForNext;
  const answeredCount =answers.size;
  const progFillWidth =useMemo(()=>`${progress}%` as `${number}%`,[progress]);

  useEffect(()=>{
    mountedRef.current=true;
    startTime.current=Date.now();
    trackEvent('start');
    return()=>{
      mountedRef.current=false;
      if(timerRef.current){clearTimeout(timerRef.current);timerRef.current=null;}
    };
  },[]);

  useEffect(()=>{
    setWaitingForNext(false);
    qStartTime.current=Date.now();
    fadeAnim.value=0.3;
    fadeAnim.value=withTiming(1,{duration:150}, []);
  },[qIndex,fadeAnim]);

  useEffect(()=>{setWaitingForNext(false);},[showInsight]);
  useEffect(()=>{if(showResults)setWaitingForNext(false);},[showResults]);

  useEffect(()=>{
    const user=auth.currentUser;
    if(!user)return;
    getDoc(doc(db,'users',user.uid)).then(snap=>{if(snap.exists()){const data=snap.data();if(data?.['personalityType'])setExistingType(String(data['personalityType']));} }).catch(()=>{});
  },[]);

  useEffect(()=>{
    try{
      const raw=appStorage.getString(DRAFT_KEY);
      if(raw){
        const d=JSON.parse(raw) as{version?:string;answers?:Record<number,AnswerScore>;qIndex?:number;qTimes?:number[];elapsed?:number};
        if(d?.version===QUIZ_VERSION&&d?.answers){dispatch({type:'LOAD',answers:d.answers});setQIndex(d.qIndex??0);qTimesRef.current=d.qTimes??[];if(d.elapsed)startTime.current=Date.now()-d.elapsed;}
      }
    }catch{}finally{setDraftLoaded(true);}
  },[]);

  useEffect(()=>{
    if(!draftLoaded||showResults)return;
    const tm=setTimeout(()=>{
      try{
        const obj:Record<number,AnswerScore>={};
        answersRef.current.forEach((v,k)=>{obj[k]=v;});
        appStorage.set(DRAFT_KEY,JSON.stringify({version:QUIZ_VERSION,answers:obj,qIndex:qIndexRef.current,qTimes:qTimesRef.current,elapsed:Date.now()-startTime.current}));
      }catch{}
    },1000);
    return()=>clearTimeout(tm);
  },[answers,qIndex,draftLoaded,showResults]);

  const haptic=useCallback(()=>{if(!IS_WEB)Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});},[]);
  const successHaptic=useCallback(()=>{if(!IS_WEB)Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(()=>{});},[]);

  const handleAnswer=useCallback((score:AnswerScore)=>{
    if(submitting||waitingForNext)return;
    haptic();
    setWaitingForNext(true);
    qTimesRef.current[qIndexRef.current]=Date.now()-qStartTime.current;
    dispatch({type:'SET',questionId:question.id,score});
    if(timerRef.current)clearTimeout(timerRef.current);
    timerRef.current=setTimeout(()=>{
      if(!mountedRef.current)return;
      const nextQ=qIndexRef.current+1;
      if(nextQ<TOTAL_QUESTIONS){
        const insightIdx=Math.floor(nextQ/INSIGHT_INTERVAL)-1;
        if(nextQ%INSIGHT_INTERVAL===0&&insightIdx>=0&&insightIdx<INSIGHTS.length){setShowInsight(INSIGHTS[insightIdx]??null);}
        else{setQIndex(nextQ);}
      }else{
        const finalAnswers=new Map(answersRef.current);
        finalAnswers.set(question.id,score);
        const totalMs=Date.now()-startTime.current;
        const res=computeResults(finalAnswers,totalMs,qTimesRef.current);
        setResults(res);successHaptic();setShowResults(true);
        try{appStorage.delete(DRAFT_KEY);}catch{}
        trackEvent('complete',totalMs);
      }
      timerRef.current=null;
    },ANSWER_DELAY_MS);
  },[question.id,submitting,waitingForNext,haptic,successHaptic]);

  const handleInsightContinue=useCallback(()=>{setShowInsight(null);setQIndex(i=>i+1);},[]);

  const handleBack=useCallback(()=>{
    if(!canGoBack||submitting||waitingForNext)return;
    haptic();setQIndex(i=>i-1);
  },[canGoBack,submitting,waitingForNext,haptic]);

  useEffect(()=>{handleAnswerRef.current=handleAnswer;},[handleAnswer]);
  useEffect(()=>{handleBackRef.current=handleBack;},[handleBack]);

  const handleSkip=useCallback(()=>{
    Alert.alert('Skip Quiz?','Your personality type helps find better matches. You can take it later from Settings.',[
      {text:'Take Quiz',style:'cancel'},
      {text:'Skip',onPress:()=>{trackEvent('skip');try{appStorage.delete(DRAFT_KEY);}catch{}router.replace('/home');}},
    ]);
  },[router]);

  const handleClose=useCallback(()=>{
    if(answers.size===0){router.back();return;}
    Alert.alert('Leave Quiz?','Your progress is auto-saved.',[
      {text:'Stay',style:'cancel'},
      {text:'Leave',onPress:()=>{trackEvent('abandon');router.back();}},
    ]);
  },[answers.size,router]);

  useEffect(()=>{
    if(!IS_WEB)return;
    const handler=(e:KeyboardEvent)=>{
      if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;
      if(showResultsRef.current||showInsightRef.current)return;
      if(submittingRef.current||waitingRef.current)return;
      if(e.key>='1'&&e.key<='5'){handleAnswerRef.current?.(ANSWER_OPTIONS[parseInt(e.key)-1]?.score??SCORE_NEUTRAL as AnswerScore);}
      else if(e.key==='ArrowLeft'){handleBackRef.current?.();}
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[]);

  const handleShare=useCallback(async()=>{
    if(!results)return;
    const msg=`🎭 My Personality: ${results.archetype.emoji} ${results.archetype.name}\n\n"${results.archetype.description}"\n\n💪 Strengths: ${results.archetype.strengths.join(', ')}\n🚀 Adventure: ${results.adventureScore}%\n🎯 Consistency: ${results.overallConsistency}%\n\nDiscover yours!`;
    try{
      if(IS_WEB&&navigator.clipboard){await navigator.clipboard.writeText(msg);Alert.alert('Copied!','Share text copied to clipboard.');}
      else{await Share.share({message:msg,title:'My Personality Type'});}
    }catch{Alert.alert('Error','Could not share.');}
  },[results]);

  const saveResults=useCallback(async()=>{
    if(!results)return;
    const user=auth.currentUser;
    if(!user){Alert.alert(t.error??'Error','Not logged in.');return;}
    setSubmitting(true);
    const abortController=new AbortController();
    const timeout=setTimeout(()=>abortController.abort(),SAVE_TIMEOUT_MS);
    try{
      await user.reload();
      const traitScores:Record<string,number>={},traitLabels:Record<string,string>={},traitConsistency:Record<string,number>={};
      for(const tr of results.traits){traitScores[tr.key]=tr.score;traitLabels[tr.key]=tr.label;traitConsistency[tr.key]=tr.consistency;}
      await updateDoc(doc(db,'users',user.uid),{
        personalityType:results.archetype.name,personalityEmoji:results.archetype.emoji,personalityTitle:results.archetype.title,
        personalityDescription:results.archetype.description,personalityArchetypeCode:results.archetypeCode,
        personalityTraits:traitScores,personalityTraitLabels:traitLabels,personalityTraitConsistency:traitConsistency,
        personalityStrengths:results.archetype.strengths,personalityGrowthAreas:results.archetype.growthAreas,
        personalityCommunicationStyle:results.archetype.communicationStyle,personalityConflictStyle:results.archetype.conflictStyle,
        personalityIdealDates:results.archetype.idealDates,personalityLoveLanguageFit:results.archetype.loveLanguageFit,
        personalityWhatYouBring:results.archetype.relationship.whatYouBring,personalityWhatYouNeed:results.archetype.relationship.whatYouNeed,
        personalityGreenFlags:results.archetype.relationship.greenFlags,personalityRedFlags:results.archetype.relationship.redFlags,
        personalityHowYouLove:results.archetype.relationship.howYouLove,personalityChallenge:results.archetype.relationship.commonChallenge,
        personalityAdventureScore:results.adventureScore,personalityConsistency:results.overallConsistency,
        personalitySummary:results.summary,personalityCompleted:true,personalityCompletedAt:results.completedAt,
        personalityQuizVersion:results.quizVersion,personalityQuizTimeMs:results.totalTimeMs,
      });
      clearTimeout(timeout);
      try{appStorage.delete(DRAFT_KEY);}catch{}
      successHaptic();router.replace('/home');
    }catch(error:unknown){
      clearTimeout(timeout);
      if(!mountedRef.current)return;
      if(abortController.signal.aborted){Alert.alert('Timeout','Save timed out. Your results are saved locally and will sync when you reconnect.');return;}
      const err=error as{code?:string;message?:string};
      if(err?.code==='auth/user-not-found'||err?.code==='auth/user-token-expired'){Alert.alert('Session Expired','Please log in again.');router.replace('/login');return;}
      if(err?.code==='permission-denied'){Alert.alert(t.error??'Error','Permission denied. Please contact support.');return;}
      try{appStorage.set(PENDING_SAVE_KEY,JSON.stringify({results,at:new Date().toISOString()}));}catch{}
      Alert.alert('Save Error',error instanceof Error?error.message:'Unknown error',[{text:'Retry',onPress:saveResults},{text:'Continue Offline',style:'cancel',onPress:()=>router.replace('/home')}]);
    }finally{if(mountedRef.current)setSubmitting(false);}
  },[results,router,successHaptic,t]);

  const executeRetake=useCallback(()=>{
    dispatch({type:'RESET'});setResults(null);setShowResults(false);setShowInsight(null);setWaitingForNext(false);setShowExplorer(false);
    fadeAnim.value=1;startTime.current=Date.now();qTimesRef.current=[];qStartTime.current=Date.now();setQIndex(0);
    try{appStorage.delete(DRAFT_KEY);}catch{}
  },[fadeAnim]);

  const retakeQuiz=useCallback(()=>{
    Alert.alert('Retake Quiz?','This will reset all your answers.',[{text:'Cancel',style:'cancel'},{text:'Retake',style:'destructive',onPress:executeRetake}]);
  },[executeRetake]);

  /* ── LOADING ── */
  if(!draftLoaded||submitting)return(
    <SafeAreaView style={st.centered}>
      <ActivityIndicator size="large" color={C.accent}/>
      <Text style={st.loadText}>{submitting?'Saving your profile…':'Loading…'}</Text>
    </SafeAreaView>
  );

  /* ── RESULTS ── */
  if(showResults&&results){
    const{archetype,traits:rTraits,adventureScore}=results;
    const mins=Math.max(1,Math.round(results.totalTimeMs/60000));
    const advFill=`${adventureScore}%` as `${number}%`;
    const advLabel=adventureScore>THRESH_STRONG_HIGH?"You're a thrill-seeker!":adventureScore>THRESH_LEAN_HIGH?'You enjoy adventure but also value comfort.':adventureScore>THRESH_LEAN_LOW?'You balance novelty with familiar comfort.':'You find deep meaning in routine and stability.';
    const consistLabel=results.overallConsistency>=80?' — Very decisive!':results.overallConsistency>=60?' — Clear preferences':' — Complex personality!';
    const rel=archetype.relationship;
    return(
      <SafeAreaView style={st.root}>
        <ScrollView contentContainerStyle={st.resScroll} showsVerticalScrollIndicator={false}>
          <View style={st.resHeader}>
            <Text style={st.resEmoji}>{archetype.emoji}</Text>
            <Text style={st.resName}>{archetype.name}</Text>
            <Text style={st.resTitle}>{archetype.title}</Text>
            <Text style={st.resDesc}>{archetype.description}</Text>
          </View>
          <View style={st.secCard}><Text style={st.secTitle}>📝 Your Personality Summary</Text><Text style={st.secBody}>{results.summary}</Text></View>
          {existingType!=null&&existingType!==archetype.name&&(<View style={st.warnCard}><Text style={st.warnText}>⚠️ Previous type: "{existingType}". Saving will update your profile.</Text></View>)}
          <View style={st.traitsCard}>
            <Text style={st.secTitle}>🌈 Your Personality Spectrum</Text>
            {rTraits.map((tr,i)=>(<TraitBar key={tr.key} trait={tr} def={TRAIT_MAP[tr.key]!} index={i}/>))}
            <View style={st.consistRow}><Text style={st.consistText}>🎯 Overall Consistency: {results.overallConsistency}%{consistLabel}</Text></View>
          </View>
          <View style={st.secCard}><Text style={st.secTitle}>💪 Your Strengths</Text><ChipList items={archetype.strengths}/></View>
          <View style={st.secCard}><Text style={st.secTitle}>🌱 Growth Areas</Text><BulletList items={archetype.growthAreas}/></View>
          <View style={st.secCard}><Text style={st.secTitle}>💗 How You Love</Text><Text style={st.secBody}>{rel.howYouLove}</Text></View>
          <View style={st.secCard}><Text style={st.secTitle}>✨ What You Bring to a Relationship</Text><BulletList items={rel.whatYouBring}bullet="✓" color={C.success}/></View>
          <View style={st.secCard}><Text style={st.secTitle}>🫶 What You Need From a Partner</Text><BulletList items={rel.whatYouNeed}/></View>
          <View style={st.secCard}><Text style={st.secTitle}>🟢 Green Flags to Look For</Text><BulletList items={rel.greenFlags}bullet="✓" color={C.success}/></View>
          <View style={st.secCard}><Text style={st.secTitle}>🔴 Red Flags to Watch For</Text><BulletList items={rel.redFlags}bullet="✕" color={C.danger}/></View>
          <View style={st.secCard}><Text style={st.secTitle}>⚡ Your Relationship Challenge</Text><Text style={st.secBody}>{rel.commonChallenge}</Text></View>
          <View style={st.secCard}><Text style={st.secTitle}>💬 Communication Style</Text><Text style={st.secBody}>{archetype.communicationStyle}</Text></View>
          <View style={st.secCard}><Text style={st.secTitle}>⚔️ Conflict Style</Text><Text style={st.secBody}>{archetype.conflictStyle}</Text></View>
          <View style={st.secCard}><Text style={st.secTitle}>🌹 Ideal Date Ideas</Text><DateList items={archetype.idealDates}/></View>
          <View style={st.secCard}><Text style={st.secTitle}>💝 Love Language Fit</Text><Text style={st.secBody}>{archetype.loveLanguageFit}</Text></View>
          <View style={st.secCard}>
            <Text style={st.secTitle}>{adventureScore>60?'🚀':'🏠'} Adventure Level</Text>
            <View style={st.advBar}>
              <Text style={st.advLow}>🏠</Text>
              <View style={st.advTrack}><View style={[st.advFill,{width:advFill}]}/></View>
              <Text style={st.advHigh}>🚀</Text>
            </View>
            <Text style={st.secBody}>{advLabel}</Text>
          </View>
          <View style={[st.secCard,st.reflectCard]}><Text style={st.secTitle}>🪞 Reflection</Text><Text style={st.reflectText}>"{rel.reflectionPrompt}"</Text></View>
          <TouchableOpacity style={st.explorerToggle} onPress={()= accessibilityLabel="button">setShowExplorer(v=>!v)} activeOpacity={0.8} accessibilityLabel={showExplorer?'Hide compatibility explorer':'Explore how you connect with other types'} accessibilityRole="button" accessibilityState={{expanded:showExplorer}}>
            <Text style={st.explorerToggleText}>{showExplorer?'▲ Hide':'▼ Explore'} How You Connect With Other Types</Text>
          </TouchableOpacity>
          {showExplorer&&<CompatibilityExplorer userCode={results.archetypeCode}/>}
          <View style={st.statsCard}>
            <Text style={st.statsTitle}>📊 Quiz Stats</Text>
            <View style={st.statsRow}>
              <View style={st.statItem}><Text style={st.statVal}>{TOTAL_QUESTIONS}</Text><Text style={st.statLbl}>Questions</Text></View>
              <View style={st.statItem}><Text style={st.statVal}>{mins}</Text><Text style={st.statLbl}>Minutes</Text></View>
              <View style={st.statItem}><Text style={st.statVal}>{results.overallConsistency}%</Text><Text style={st.statLbl}>Consistent</Text></View>
              <View style={st.statItem}><Text style={st.statVal}>v{QUIZ_VERSION}</Text><Text style={st.statLbl}>Version</Text></View>
            </View>
          </View>
          <TouchableOpacity style={st.shareBtn} onPress={handleShare} activeOpacity={0.8} accessibilityLabel="Share my personality type" accessibilityRole="button"><Text style={st.shareBtnText}>📤 Share My Type</Text></TouchableOpacity>
          <TouchableOpacity style={st.saveBtn} onPress={saveResults} activeOpacity={0.8} accessibilityLabel="Save results and continue" accessibilityRole="button"><Text style={st.saveBtnText}>✓ Save & Continue</Text></TouchableOpacity>
          <TouchableOpacity style={st.retakeBtn} onPress={retakeQuiz} activeOpacity={0.7} accessibilityLabel="Retake the personality quiz" accessibilityRole="button"><Text style={st.retakeBtnText}>🔄 Retake Quiz</Text></TouchableOpacity>
          <View style={{height:40}}/>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ── INSIGHT CARD ── */
  if(showInsight)return(
    <SafeAreaView style={st.root}>
      <View style={st.content}><InsightScreen card={showInsight} onContinue={handleInsightContinue}/></View>
    </SafeAreaView>
  );

  /* ── QUIZ ── */
  return(
    <SafeAreaView style={st.root}>
      <View style={st.header}>
        <View style={st.headerL}>
          <TouchableOpacity onPress={handleClose} hitSlop={HIT} accessibilityLabel="Close quiz" accessibilityRole="button"><Text style={st.closeText}>✕</Text></TouchableOpacity>
          {canGoBack&&(<TouchableOpacity onPress={handleBack} hitSlop={HIT} accessibilityLabel="Go to previous question" accessibilityRole="button"><Text style={st.backText}>← Back</Text></TouchableOpacity>)}
        </View>
        <Text style={st.counter} accessibilityLabel={`Question ${qIndex+1} of ${TOTAL_QUESTIONS}`}>{qIndex+1} / {TOTAL_QUESTIONS}</Text>
        <View style={st.headerR}/>
      </View>
      <View style={st.progBg} accessibilityRole="progressbar" accessibilityLabel={`${Math.round(progress)}% complete`}>
        <View style={[st.progFill,{width:progFillWidth}]}/>
      </View>
      <ProgressDots total={TOTAL_QUESTIONS} current={qIndex} answeredCount={answeredCount}/>
      <View style={st.badge}>
        <View style={[st.badgeDot,{backgroundColor:trait.color}]}/>
        <Text style={st.badgeText}>{trait.name}</Text>
        <Text style={st.badgeDesc}>{trait.description}</Text>
      </View>
      <ScrollView style={st.scroll} contentContainerStyle={st.scrollInner} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View style={[st.content,fadeStyle]}>
          {question.scenario!=null&&<Text style={st.scenario}>{question.scenario}</Text>}
          {question.weight>1&&(<View style={st.keyQ}><Text style={st.keyQText}>⭐ Key Question</Text></View>)}
          <Text style={st.question} accessibilityRole="header">{question.question}</Text>
          <View style={st.sidesRow} accessibilityElementsHidden>
            <View style={[st.side,{borderColor:trait.color}]}><Text style={st.sideEmoji}>{trait.lowEmoji}</Text><Text style={st.sideText}>{trait.lowLabel}</Text></View>
            <View style={[st.side,{borderColor:trait.color}]}><Text style={st.sideEmoji}>{trait.highEmoji}</Text><Text style={st.sideText}>{trait.highLabel}</Text></View>
          </View>
          <View style={st.optWrap}>
            <Text style={st.sideDesc}>{question.sideA}</Text>
            <View style={st.optBtns} accessibilityRole="radiogroup" accessibilityLabel={question.question}>
              {ANSWER_OPTIONS.map(opt=>(<AnswerButton key={`${question.id}-${opt.id}`} option={opt} question={question} traitColor={trait.color} isSelected={currentAnswer===opt.score} onAnswer={handleAnswer} disabled={buttonsDisabled}/>))}
            </View>
            <Text style={[st.sideDesc,st.sideDescR]}>{question.sideB}</Text>
            <View style={st.scaleRow}>
              <Text style={st.scaleLbl}>{trait.lowEmoji} {trait.lowLabel}</Text>
              <View style={st.scaleLine}/>
              <Text style={st.scaleLbl}>{trait.highLabel} {trait.highEmoji}</Text>
            </View>
            {IS_WEB&&<Text style={st.kbHint}>⌨️ Press 1–5 to answer, ← to go back</Text>}
          </View>
        </Animated.View>
      </ScrollView>
      <TouchableOpacity style={st.skipBtn} onPress={handleSkip} hitSlop={HIT} accessibilityLabel="Skip quiz for now" accessibilityRole="button">
        <Text style={st.skipText}>Skip for now</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

/* ═══ EXPORT ═══ */
export default function PersonalityQuizScreen(){
  const[key,setKey]=useState(0);
  const handleReset=useCallback(()=>setKey(k=>k+1),[]);
  return(<QuizErrorBoundary onReset={handleReset}><PersonalityQuizInner key={key}/></QuizErrorBoundary>);
}

/* ═══ STYLES ═══ */
const st=StyleSheet.create((theme)=>({
  root:{flex:1,backgroundColor:theme.colors.background,paddingHorizontal:20},
  centered:{flex:1,backgroundColor:theme.colors.background,justifyContent:'center',alignItems:'center',gap:16,paddingHorizontal:20},
  content:{justifyContent:'center',flex:1},
  scroll:{flex:1},
  scrollInner:{flexGrow:1,justifyContent:'center',paddingBottom:20},
  loadText:{color:C.accent,fontSize:18,textAlign:'center'},
  errTitle:{color:theme.colors.text,fontSize:22,fontWeight:'bold',marginBottom:8,textAlign:'center'},
  errMsg:{color:theme.colors.textSecondary,fontSize:14,textAlign:'center',marginBottom:24,lineHeight:20},
  errBtn:{backgroundColor:C.accent,paddingVertical:14,paddingHorizontal:32,borderRadius:25},
  errBtnText:{color:C.white,fontSize:16,fontWeight:'600'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:10},
  headerL:{flex:1,flexDirection:'row',alignItems:'center',gap:16},
  headerR:{flex:1},
  closeText:{color:C.dim,fontSize:20,fontWeight:'600'},
  backText:{color:C.accent,fontSize:16},
  counter:{color:theme.colors.textSecondary,fontSize:14,textAlign:'center'},
  progBg:{height:6,backgroundColor:C.card,borderRadius:3,overflow:'hidden',marginBottom:6},
  progFill:{height:'100%',backgroundColor:C.accent,borderRadius:3},
  dotsRow:{flexDirection:'row',justifyContent:'center',gap:3,marginBottom:10,flexWrap:'wrap',paddingHorizontal:8},
  dot:{width:7,height:7,borderRadius:4,backgroundColor:C.card},
  dotDone:{backgroundColor:C.success},
  dotCur:{backgroundColor:C.accent,transform:[{scale:1.5}]},
  badge:{alignItems:'center',backgroundColor:C.card,paddingVertical:8,paddingHorizontal:14,borderRadius:12,gap:3,marginBottom:10},
  badgeDot:{width:10,height:10,borderRadius:5},
  badgeText:{color:theme.colors.text,fontSize:14,fontWeight:'600'},
  badgeDesc:{color:C.muted,fontSize:11,textAlign:'center',lineHeight:15},
  scenario:{color:C.muted,fontSize:13,textAlign:'center',marginBottom:6,fontStyle:'italic'},
  keyQ:{alignSelf:'center',backgroundColor:'rgba(241,196,15,0.15)',paddingVertical:4,paddingHorizontal:12,borderRadius:12,marginBottom:8},
  keyQText:{color:C.gold,fontSize:11,fontWeight:'600'},
  question:{fontSize:19,fontWeight:'bold',color:theme.colors.text,textAlign:'center',marginBottom:18,lineHeight:28},
  sidesRow:{flexDirection:'row',justifyContent:'space-between',marginBottom:10,gap:10},
  side:{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,backgroundColor:C.card,paddingVertical:7,paddingHorizontal:8,borderRadius:12,borderWidth:1},
  sideEmoji:{fontSize:15},
  sideText:{color:theme.colors.textSecondary,fontSize:11,fontWeight:'600'},
  optWrap:{gap:6},
  sideDesc:{color:theme.colors.textSecondary,fontSize:13,textAlign:'left',lineHeight:18,paddingHorizontal:4},
  sideDescR:{textAlign:'right'},
  optBtns:{flexDirection:'row',justifyContent:'space-between',gap:5,marginVertical:6},
  optBtn:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:C.card,paddingVertical:10,paddingHorizontal:3,borderRadius:12,borderWidth:2,borderColor:C.none,minHeight:66},
  optBtnSel:{backgroundColor:C.cardHi},
  optBtnMid:{backgroundColor:'rgba(83,168,182,0.08)',borderColor:C.input},
  optEmoji:{fontSize:16,marginBottom:2},
  optLabel:{color:C.muted,fontSize:10,textAlign:'center'},
  optLabelSel:{color:theme.colors.text,fontWeight:'bold'},
  optLabelMid:{color:C.accent},
  scaleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:4,gap:8},
  scaleLbl:{color:C.dim,fontSize:10},
  scaleLine:{flex:1,height:1,backgroundColor:C.input},
  kbHint:{color:C.dim,fontSize:11,textAlign:'center',marginTop:10,fontStyle:'italic'},
  skipBtn:{alignSelf:'center',paddingVertical:12},
  skipText:{color:C.dim,fontSize:14},
  insightWrap:{flex:1,justifyContent:'center',alignItems:'center',paddingHorizontal:20},
  insightEmoji:{fontSize:60,marginBottom:16},
  insightTitle:{fontSize:22,fontWeight:'bold',color:theme.colors.text,marginBottom:10,textAlign:'center'},
  insightBody:{fontSize:16,color:theme.colors.textSecondary,textAlign:'center',lineHeight:24,marginBottom:30,paddingHorizontal:10},
  insightBtn:{backgroundColor:C.accent,paddingVertical:16,paddingHorizontal:40,borderRadius:25},
  insightBtnText:{color:C.white,fontSize:16,fontWeight:'600'},
  resScroll:{padding:20,paddingBottom:40},
  resHeader:{alignItems:'center',marginBottom:20,marginTop:12},
  resEmoji:{fontSize:70,marginBottom:10},
  resName:{fontSize:26,fontWeight:'bold',color:theme.colors.text,marginBottom:4},
  resTitle:{fontSize:17,color:C.accent,fontWeight:'600',marginBottom:10},
  resDesc:{fontSize:14,color:theme.colors.textSecondary,textAlign:'center',lineHeight:21,marginBottom:10},
  secCard:{backgroundColor:C.card,borderRadius:16,padding:18,marginBottom:14},
  secTitle:{fontSize:17,fontWeight:'bold',color:theme.colors.text,marginBottom:10},
  secBody:{fontSize:14,color:theme.colors.textSecondary,lineHeight:21,flex:1},
  warnCard:{backgroundColor:'rgba(230,126,34,0.15)',borderWidth:1,borderColor:C.warning,borderRadius:12,padding:12,marginBottom:14},
  warnText:{color:C.warning,fontSize:13,lineHeight:19},
  traitsCard:{backgroundColor:C.card,borderRadius:16,padding:18,marginBottom:14},
  trRow:{marginBottom:18},
  trLabels:{flexDirection:'row',justifyContent:'space-between',marginBottom:5},
  trLow:{color:theme.colors.textSecondary,fontSize:11},
  trHigh:{color:theme.colors.textSecondary,fontSize:11},
  trBarBg:{height:12,backgroundColor:C.input,borderRadius:6,overflow:'visible',position:'relative'},
  trBarFill:{height:'100%',borderRadius:6},
  trDot:{position:'absolute',top:-4,width:20,height:20,borderRadius:10,marginLeft:-10,borderWidth:3,borderColor:theme.colors.background},
  trBottom:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:5},
  trLabel:{fontSize:12,fontWeight:'600'},
  trConsist:{fontSize:10,color:C.dim},
  consistRow:{borderTopWidth:1,borderTopColor:C.input,paddingTop:12,marginTop:6},
  consistText:{fontSize:13,color:C.muted,textAlign:'center'},
  chipGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},
  chip:{backgroundColor:C.input,paddingVertical:7,paddingHorizontal:13,borderRadius:20},
  chipText:{color:C.accent,fontSize:13,fontWeight:'600'},
  bulletRow:{flexDirection:'row',gap:8,marginBottom:8,alignItems:'flex-start'},
  bulletDot:{fontSize:14,fontWeight:'bold',marginTop:2,width:16},
  dateRow:{flexDirection:'row',gap:10,marginBottom:8,alignItems:'flex-start'},
  dateNum:{color:C.accent,fontSize:14,fontWeight:'bold',width:20,textAlign:'center',marginTop:2},
  advBar:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10},
  advLow:{color:C.muted,fontSize:14},
  advHigh:{color:C.muted,fontSize:14},
  advTrack:{flex:1,height:8,backgroundColor:C.input,borderRadius:4,overflow:'hidden'},
  advFill:{height:'100%',backgroundColor:C.warning,borderRadius:4},
  reflectCard:{borderLeftWidth:3,borderLeftColor:C.accent},
  reflectText:{fontSize:15,color:theme.colors.text,fontStyle:'italic',lineHeight:23},
  explorerToggle:{backgroundColor:C.card,borderRadius:12,paddingVertical:14,paddingHorizontal:18,alignItems:'center',marginBottom:10},
  explorerToggleText:{color:C.accent,fontSize:15,fontWeight:'600'},
  explorerDisclaimer:{color:C.muted,fontSize:12,lineHeight:18,marginBottom:12,fontStyle:'italic'},
  compatItem:{marginBottom:4},
  compatRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:10,paddingHorizontal:4,borderRadius:10},
  compatRowSelf:{backgroundColor:'rgba(83,168,182,0.1)'},
  compatEmoji:{fontSize:24},
  compatInfo:{flex:1},
  compatName:{color:theme.colors.text,fontSize:14,fontWeight:'600',marginBottom:2},
  compatTagline:{color:C.muted,fontSize:12},
  compatChevron:{color:C.dim,fontSize:12},
  compatDetail:{backgroundColor:C.cardHi,borderRadius:10,padding:12,marginTop:4,gap:8},
  compatStrength:{color:C.success,fontSize:13,lineHeight:19},
  compatWatch:{color:C.warning,fontSize:13,lineHeight:19},
  compatSelfNote:{color:C.accent,fontSize:12,lineHeight:18,fontStyle:'italic',marginTop:4},
  statsCard:{backgroundColor:C.card,borderRadius:16,padding:18,marginBottom:14,alignItems:'center'},
  statsTitle:{fontSize:15,fontWeight:'600',color:theme.colors.text,marginBottom:12},
  statsRow:{flexDirection:'row',gap:20},
  statItem:{alignItems:'center'},
  statVal:{fontSize:20,fontWeight:'bold',color:C.accent},
  statLbl:{fontSize:10,color:C.muted,marginTop:2},
  shareBtn:{backgroundColor:C.purple,paddingVertical:15,borderRadius:25,alignItems:'center',marginTop:6},
  shareBtnText:{color:C.white,fontSize:16,fontWeight:'600'},
  saveBtn:{backgroundColor:C.success,paddingVertical:16,borderRadius:25,alignItems:'center',marginTop:10},
  saveBtnText:{color:C.white,fontSize:17,fontWeight:'bold'},
  retakeBtn:{paddingVertical:12,alignItems:'center',marginTop:6},
  retakeBtnText:{color:C.accent,fontSize:15},
  matchName:{fontSize:16,fontWeight:'600',color:C.accent,marginBottom:6},
  compatR:{fontSize:13,color:C.muted,lineHeight:19,fontStyle:'italic',marginBottom:8},
  matchHint:{color:C.accent,fontSize:12,fontStyle:'italic',lineHeight:18},
}));