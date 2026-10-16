"use strict";
const access={permissions:["scripting"],origins:["https://shopee.co.th/*"]};
const status=document.getElementById("status");
async function refresh(){
  const [scripting,host]=await Promise.all([chrome.permissions.contains({permissions:access.permissions}),chrome.permissions.contains({origins:access.origins})]);
  const missing=[!scripting?"สิทธิ์ scripting":null,!host?"สิทธิ์เว็บไซต์ shopee.co.th":null].filter(Boolean);
  status.textContent=missing.length?`ยังอ่านไม่ได้ — ขาด ${missing.join(" และ ")} กรุณาใช้ปุ่มอนุญาตหน้านี้และยืนยันหน้าต่าง Chrome`:`เปิดสิทธิ์ครบแล้ว — ShopKud ${chrome.runtime.getManifest().version} อ่านได้เฉพาะหน้าสินค้าที่ระบุ`;
}
document.getElementById("enable").addEventListener("click",async event=>{
  if(!event.isTrusted)return;
  try{await chrome.permissions.request(access);await refresh();}catch{status.textContent="อนุญาตไม่สำเร็จ กรุณาตรวจหน้าต่าง Chrome";}
});
document.getElementById("disable").addEventListener("click",async event=>{
  if(!event.isTrusted)return;
  try{await chrome.permissions.remove(access);await refresh();}catch{status.textContent="ปิดสิทธิ์ไม่สำเร็จ กรุณาตรวจการตั้งค่าส่วนขยาย";}
});
refresh().catch(()=>{status.textContent="ตรวจสิทธิ์ไม่สำเร็จ";});
