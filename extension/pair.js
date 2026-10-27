"use strict";
const approve=document.getElementById("approve"),status=document.getElementById("status");
const pairingNonce=location.hash.slice(1);
history.replaceState(null,"",location.pathname+location.search);
const requestedPort=Number(new URLSearchParams(location.search).get("port"));
if(Number.isInteger(requestedPort)&&requestedPort>=1024&&requestedPort<=65535)document.getElementById("port").value=requestedPort;
approve.addEventListener("click",()=>{
  const port=Number(document.getElementById("port").value);
  if(!Number.isInteger(port)||port<1024||port>65535||!/^[0-9a-f]{64}$/u.test(pairingNonce)){
    status.textContent="ให้ Agent เปิดหน้าจับคู่ใหม่ แล้วกดอนุญาตที่หน้านั้น";return;
  }
  approve.disabled=true;status.textContent="กำลังเชื่อมต่อ…";
  const url=`ws://127.0.0.1:${port}/extension`,socket=new WebSocket(url);
  let paired=false;
  const timeout=setTimeout(()=>socket.close(),10000);
  socket.onopen=()=>socket.send(JSON.stringify({type:"pair",nonce:pairingNonce}));
  socket.onmessage=async event=>{
    try {
      const result=JSON.parse(event.data);
      if(result.type!=="paired"||!/^[0-9a-f]{64}$/u.test(result.token))throw new Error();
      await shopkudPairing({url,token:result.token});
      await chrome.runtime.sendMessage({type:"shopkud-pairing-updated"});
      paired=true;status.textContent="เชื่อมต่อแล้ว เปิด Dashboard เพื่อเริ่มใช้งาน";
    } catch {status.textContent="เชื่อมต่อไม่สำเร็จ ให้ Agent ตรวจการติดตั้ง";}
    finally {socket.close();}
  };
  socket.onerror=()=>socket.close();
  socket.onclose=()=>{clearTimeout(timeout);approve.disabled=false;if(!paired)status.textContent="ยังเชื่อมต่อไม่ได้ ให้ Agent เปิดโหมด pairing แล้วลองใหม่";};
});
