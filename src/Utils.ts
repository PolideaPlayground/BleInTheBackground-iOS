import AsyncStorage from '@react-native-community/async-storage';
import {AppState} from 'react-native';
import Background from './Background';

let inForeground = true;
AppState.addEventListener('change', state => {
  inForeground = state === 'active';
  log(`App state: ${state}`);
});

let logListeners: Array<(message: string) => void> = [];

export function addLogListener(listener: (message: string) => void) {
  logListeners.push(listener);
}

export function removeLogListener(listener: (message: string) => void) {
  logListeners = logListeners.filter(currentListener => {
    return currentListener !== listener;
  });
}

export function log(message: string) {
  const time = Date.now().toString();
  const messageWithTime = `${time}: ${message}`;
  console.log(messageWithTime);
  AsyncStorage.setItem(time, messageWithTime).catch(error => {
    console.warn(
      `Failed to send log: "${messageWithTime}" due to error: ${error.message}`,
    );
  });
  if (inForeground) {
    for (const listener of logListeners) {
      listener(messageWithTime);
    }
  }
}

export async function collectLogs() {
  const keys = await AsyncStorage.getAllKeys();
  let keyValueArray: Array<[string, string]> = [];
  for (const key of keys) {
    const value = await AsyncStorage.getItem(key);
    if (value == null) {
      continue;
    }
    keyValueArray.push([key, value]);
  }
  return keyValueArray
    .sort((a, b) => {
      return b < a ? 1 : -1;
    })
    .map(array => {
      return array[1];
    });
}

export function clearAllLogs() {
  return AsyncStorage.clear();
}

export function delay(timeout: number) {
  return new Promise(resolve => {
    Background.setTimeout(resolve, timeout);
  });
}
