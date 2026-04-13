import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../../firebaseConfig';
import { logger, writeAuditLog } from '../../utils/logger';

interface Report { id:string; reporterId:string; reporterName?:string; reportedUserId:string; reportedUserName:string; reportedUserPhoto?:string; reason:string; createdAt:string; status:string; }
type Resolution = 'dismissed'|'warned'|'banned';
type FilterType = 'pending'|'resolved'|'all';

const RESOLUTION_CONFIG: Record<Resolution, {title:string; msg:(n:string)=>string; btn:string}> = {
  dismissed:{title:'Dismiss Report',msg:()=>'Mark as resolved with no action?',btn:'Dismiss'},
  warned:{title:'Warn User',msg:(n)=>`Send warning to ${n}?`,btn:'Warn'},
  banned:{title:'Ban User',msg:(n)=>`BAN ${n}? This cannot be undone.`,btn:'Ban'},
};

const formatDate = (d:string) => { const dt=new Date(d); return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`; };

export default function AdminReportsScreen() {
  const router = useRouter();
  const [loading,setLoading]=useState(true), [refreshing,setRefreshing]=useState(false), [isAdmin,setIsAdmin]=useState(false), [reports,setReports]=useState<Report[]>([]), [filter,setFilter]=useState<FilterType>('pending');

  const checkAdmin = useCallback(async () => {
    try {
      const u=auth.currentUser; if(!u){router.replace('/login');return;}
      const snap=await getDoc(doc(db,'users',u.uid));
      if(!snap.exists()||!(snap.data().isAdmin as boolean|undefined)){router.replace('/home');return;}
      setIsAdmin(true);
    } catch(e){logger.error('[AdminReports] admin check failed:',e);router.replace('/home');}
  },[router]);

  useEffect(()=>{void checkAdmin();},[checkAdmin]);

  const loadReports = useCallback(async () => {
    try {
      const q = filter==='all' ? query(collection(db,'reports')) : query(collection(db,'reports'),where('status','==',filter));
      const snap=await getDocs(q);
      const list:Report[]=[];
      // Batch user fetches to avoid N+1
      const userIds=[...new Set(snap.docs.map(d=>d.data().reporterId as string).concat(snap.docs.map(d=>d.data().reportedUserId as string)))];
      const userMap:Record<string,{name?:string;photos?:string[]}>={};
      for(let i=0;i<userIds.length;i+=10){
        const chunk=userIds.slice(i,i+10);
        const res=await getDocs(query(collection(db,'users'),where('__name__','in',chunk)));
        res.docs.forEach(d=>userMap[d.id]={name:d.data().name,photos:d.data().photos});
      }
      snap.docs.forEach(docSnap=>{
        const d=docSnap.data();
        const rep=userMap[d.reporterId as string], target=userMap[d.reportedUserId as string];
        list.push({id:docSnap.id,reporterId:String(d.reporterId??''),reporterName:String(rep?.name??'Unknown'),reportedUserId:String(d.reportedUserId??''),reportedUserName:String(d.reportedUserName??'Unknown'),reportedUserPhoto:String(target?.photos?.[0]??''),reason:String(d.reason??''),createdAt:String(d.createdAt??''),status:String(d.status??'pending')});
      });
      list.sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
      setReports(list);
    } catch(e){logger.error('[AdminReports] loadReports error:',e);}
    finally{setLoading(false);setRefreshing(false);}
  },[filter]);

  useEffect(()=>{if(isAdmin)void loadReports();},[filter,isAdmin,loadReports]);
  const handleRefresh = useCallback(()=>{setRefreshing(true);void loadReports();},[loadReports]);

  const resolveReport = useCallback(async (report:Report, resolution:Resolution) => {
    try {
      const batch=writeBatch(db);
      if(resolution==='banned'){
        batch.update(doc(db,'users',report.reportedUserId),{isBanned:true,bannedAt:new Date().toISOString(),bannedBy:auth.currentUser?.uid??'',banReason:report.reason});
      } else if(resolution==='warned'){
        batch.update(doc(db,'users',report.reportedUserId),{warnings:((await getDoc(doc(db,'users',report.reportedUserId))).data()?.warnings as number|undefined)??0+1,lastWarningAt:new Date().toISOString(),lastWarningReason:report.reason});
      }
      batch.update(doc(db,'reports',report.id),{status:'resolved',resolvedAt:new Date().toISOString(),resolution,resolvedBy:auth.currentUser?.uid??''});
      await batch.commit();
      await writeAuditLog('admin.report_resolved',{reportId:report.id,resolution,target:report.reportedUserId});
      Alert.alert('Done',resolution==='banned'?`${report.reportedUserName} banned`:`Report ${resolution}`);
      void loadReports();
    } catch(e){logger.error(`[AdminReports] ${resolution} error:`,e);Alert.alert('Error','Failed to process report');}
  },[loadReports]);

  const confirmAction = useCallback((report:Report, resolution:Resolution) => {
    const {title,msg,btn}=RESOLUTION_CONFIG[resolution];
    Alert.alert(title,msg(report.reportedUserName),[{text:'Cancel',style:'cancel'},{text:btn,style:'destructive',onPress:()=>void resolveReport(report,resolution)}]);
  },[resolveReport]);

  const renderItem = useCallback(({item}:{item:Report})=>(
    <View style={[s.reportCard,item.status==='pending'&&s.reportCardPending]} accessibilityLabel={`Report: ${item.reportedUserName} by ${item.reporterName??'Unknown'}, ${item.status}`}>
      <View style={s.reportHeader}>
        {item.reportedUserPhoto?<Image source={{uri:item.reportedUserPhoto}} style={s.reportPhoto} accessibilityLabel={`Photo of ${item.reportedUserName}`} />:<View style={s.reportPhotoPlaceholder} accessibilityLabel={`No photo for ${item.reportedUserName}`}><Text style={s.reportPhotoText}>?</Text></View>}
        <View style={s.reportInfo}><Text style={s.reportedName} maxFontSizeMultiplier={1.1}>{item.reportedUserName}</Text><Text style={s.reporterText} maxFontSizeMultiplier={1.1}>Reported by: {item.reporterName}</Text><Text style={s.reportDate} maxFontSizeMultiplier={1.1}>{formatDate(item.createdAt)}</Text></View>
        <View style={[s.statusBadge,item.status==='pending'?s.statusPending:s.statusResolved]}><Text style={s.statusText} maxFontSizeMultiplier={1.1}>{item.status}</Text></View>
      </View>
      <View style={s.reasonContainer}><Text style={s.reasonLabel} maxFontSizeMultiplier={1.1}>Reason:</Text><Text style={s.reasonText} maxFontSizeMultiplier={1.1}>{item.reason}</Text></View>
      {item.status==='pending'&&(
        <View style={s.reportActions}>
          {[{res:'dismissed' as Resolution,label:'Dismiss',style:s.dismissButton,textStyle:s.dismissButtonText},{res:'warned' as Resolution,label:'Warn',style:s.warnButton,textStyle:s.warnButtonText},{res:'banned' as Resolution,label:'Ban',style:s.banButton,textStyle:s.banButtonText}].map(({res,label,style,textStyle})=>(
            <TouchableOpacity key={res} style={style} onPress={()=>confirmAction(item,res)} hitSlop={12} accessibilityLabel={`${label} ${item.reportedUserName}`} accessibilityRole="button"><Text style={textStyle} maxFontSizeMultiplier={1.1}>{label}</Text></TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  ),[confirmAction]);

  if(!isAdmin||loading) return <View style={s.loadingContainer}><ActivityIndicator size="large" color="#53a8b6" /><Text style={s.loadingText} maxFontSizeMultiplier={1.1}>{!isAdmin?'Verifying admin access...':'Loading reports...'}</Text></View>;

  return (
    <View style={s.container}>
      <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={1.1}>User Reports</Text>
      <View style={s.filterTabs} accessibilityRole="tablist">
        {(['pending','resolved','all'] as const).map(f=>(
          <TouchableOpacity key={f} style={[s.filterTab,filter===f&&s.filterTabActive]} onPress={()=>setFilter(f)} hitSlop={12} accessibilityLabel={`Filter by ${f}`} accessibilityRole="tab" accessibilityState={{selected:filter===f}}><Text style={[s.filterTabText,filter===f&&s.filterTabTextActive]} maxFontSizeMultiplier={1.1}>{f.charAt(0).toUpperCase()+f.slice(1)}</Text></TouchableOpacity>
        ))}
      </View>
      {reports.length===0?<View style={s.emptyContainer}><Text style={s.emptyIcon} accessibilityElementsHidden>✓</Text><Text style={s.emptyText} maxFontSizeMultiplier={1.1}>{filter==='pending'?'No pending reports!':'No reports found'}</Text></View>:<FlatList data={reports} keyExtractor={i=>i.id} renderItem={renderItem} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#53a8b6" />} />}
    </View>
  );
}

const s=StyleSheet.create({container:{flex:1,backgroundColor:'#1a1a2e',padding:20,paddingTop:60},loadingContainer:{flex:1,backgroundColor:'#1a1a2e',justifyContent:'center',alignItems:'center'},loadingText:{color:'#aaa',marginTop:15,fontSize:16},title:{fontSize:24,fontWeight:'bold',color:'#eee',marginBottom:20,textAlign:'center'},filterTabs:{flexDirection:'row',marginBottom:20,backgroundColor:'#16213e',borderRadius:10,padding:5},filterTab:{flex:1,paddingVertical:10,alignItems:'center',borderRadius:8},filterTabActive:{backgroundColor:'#53a8b6'},filterTabText:{color:'#888',fontSize:14,fontWeight:'600'},filterTabTextActive:{color:'#fff'},emptyContainer:{flex:1,justifyContent:'center',alignItems:'center'},emptyIcon:{fontSize:60,color:'#5cb85c',marginBottom:15},emptyText:{fontSize:18,color:'#aaa'},reportCard:{backgroundColor:'#16213e',borderRadius:15,padding:15,marginBottom:15},reportCardPending:{borderWidth:2,borderColor:'#e74c3c'},reportHeader:{flexDirection:'row',alignItems:'center',marginBottom:12},reportPhoto:{width:50,height:50,borderRadius:25,marginRight:12},reportPhotoPlaceholder:{width:50,height:50,borderRadius:25,backgroundColor:'#0f3460',justifyContent:'center',alignItems:'center',marginRight:12},reportPhotoText:{fontSize:20,color:'#666'},reportInfo:{flex:1},reportedName:{fontSize:16,fontWeight:'bold',color:'#eee'},reporterText:{fontSize:12,color:'#888',marginTop:2},reportDate:{fontSize:11,color:'#666',marginTop:2},statusBadge:{paddingVertical:4,paddingHorizontal:10,borderRadius:10},statusPending:{backgroundColor:'#e74c3c'},statusResolved:{backgroundColor:'#5cb85c'},statusText:{color:'#fff',fontSize:11,fontWeight:'600',textTransform:'capitalize'},reasonContainer:{backgroundColor:'#0f3460',borderRadius:10,padding:12,marginBottom:12},reasonLabel:{fontSize:12,color:'#888',marginBottom:5},reasonText:{fontSize:14,color:'#eee',lineHeight:20},reportActions:{flexDirection:'row',gap:10},dismissButton:{flex:1,backgroundColor:'#0f3460',paddingVertical:10,borderRadius:20,alignItems:'center'},dismissButtonText:{color:'#888',fontSize:14,fontWeight:'600'},warnButton:{flex:1,backgroundColor:'#e67e22',paddingVertical:10,borderRadius:20,alignItems:'center'},warnButtonText:{color:'#fff',fontSize:14,fontWeight:'600'},banButton:{flex:1,backgroundColor:'#e74c3c',paddingVertical:10,borderRadius:20,alignItems:'center'},banButtonText:{color:'#fff',fontSize:14,fontWeight:'600'}});