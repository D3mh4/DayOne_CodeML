import './global.css';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatScreen } from './src/screens/chat_screen';

export default function App() {
  return (
    <SafeAreaProvider>
      <ChatScreen />
    </SafeAreaProvider>
  );
}
