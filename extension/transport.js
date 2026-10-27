"use strict";
// Extension-origin IndexedDB is not exposed to Shopee content scripts. Keep
// chrome.storage.local unchanged: it also holds once-only action receipts.
function shopkudPairing(value) {
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open("shopkud-connection",1);
    open.onupgradeneeded=()=>open.result.createObjectStore("settings");
    open.onerror=()=>reject(new Error("pairing_storage_unavailable"));
    open.onsuccess=()=>{
      const db=open.result,transaction=db.transaction("settings",value===undefined?"readonly":"readwrite");
      const store=transaction.objectStore("settings"),request=value===undefined?store.get("connection"):store.put(value,"connection");
      transaction.oncomplete=()=>{db.close();resolve(value===undefined?request.result:value);};
      transaction.onerror=()=>{db.close();reject(new Error("pairing_storage_unavailable"));};
    };
  });
}
// Preserve the native channel interface so all workflow/cancellation code is shared.
function shopkudSocketChannel(config) {
  if (!/^ws:\/\/127\.0\.0\.1:\d{4,5}\/extension$/u.test(config.url) || !/^[0-9a-f]{64}$/u.test(config.token)) throw new Error("invalid_pairing");
  const socket = new WebSocket(config.url);
  const messages = [], disconnects = [];
  let heartbeat;
  const channel = {
    onMessage: {addListener(fn) {messages.push(fn);}},
    onDisconnect: {addListener(fn) {disconnects.push(fn);}},
    postMessage(value) {socket.send(JSON.stringify(value));},
    disconnect() {socket.close();}
  };
  socket.onopen = () => {
    channel.postMessage({type:"hello",token:config.token});
    heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)channel.postMessage({type:"ping"});},20000);
  };
  socket.onmessage = event => {
    try {const value=JSON.parse(event.data);if(value.type!=="pong")for(const fn of messages)fn(value);}
    catch {socket.close();}
  };
  socket.onclose = () => {clearInterval(heartbeat);for(const fn of disconnects)fn();};
  socket.onerror = () => socket.close();
  return channel;
}
