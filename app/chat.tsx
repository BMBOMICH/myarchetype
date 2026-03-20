import CryptoJS from 'crypto-js';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';

const ENCRYPTION_KEY = 'MyArchetype-Secret-Key-2026'; // In production, use env variables

interface Message {
  id: string;
  text: string;
  senderId: string;
  timestamp: any;
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { matchId, matchName } = params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  const user = auth.currentUser;
  const chatId = [user?.uid, matchId].sort().join('_'); // Consistent chat ID

  useEffect(() => {
    if (!user || !matchId) return;

    console.log('💬 Loading chat with', matchName);

    // Real-time listener for messages
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedMessages: Message[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        // Decrypt message
        const decryptedText = CryptoJS.AES.decrypt(data.encryptedText, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
        
        loadedMessages.push({
          id: doc.id,
          text: decryptedText,
          senderId: data.senderId,
          timestamp: data.timestamp,
        });
      });

      setMessages(loadedMessages);
      setLoading(false);
      
      // Scroll to bottom
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    return () => unsubscribe();
  }, [user, matchId]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !user) return;

    const messageText = newMessage.trim();
    setNewMessage('');

    try {
      // Encrypt message
      const encryptedText = CryptoJS.AES.encrypt(messageText, ENCRYPTION_KEY).toString();

      const messagesRef = collection(db, 'chats', chatId, 'messages');
      await addDoc(messagesRef, {
        encryptedText: encryptedText,
        senderId: user.uid,
        timestamp: serverTimestamp(),
      });

      console.log('✅ Message sent (encrypted)');
    } catch (error) {
      console.error('Error sending message:', error);
      window.alert('Failed to send message');
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.senderId === user?.uid;

    return (
      <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
        <Text style={styles.messageText}>{item.text}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
<TouchableOpacity onPress={() => router.replace('/my-matches')}>
  <Text style={styles.backButton}>← Back</Text>
</TouchableOpacity>
        <Text style={styles.headerTitle}>{matchName}</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading chat...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor="#666"
          value={newMessage}
          onChangeText={setNewMessage}
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  backButton: {
    color: '#53a8b6',
    fontSize: 16,
  },
  headerTitle: {
    color: '#eee',
    fontSize: 18,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#aaa',
    fontSize: 16,
  },
  messagesList: {
    padding: 15,
  },
  messageBubble: {
    maxWidth: '70%',
    padding: 12,
    borderRadius: 15,
    marginBottom: 10,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#0f3460',
  },
  theirMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#16213e',
  },
  messageText: {
    color: '#eee',
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 15,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    color: '#fff',
    padding: 12,
    borderRadius: 20,
    fontSize: 16,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#53a8b6',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});