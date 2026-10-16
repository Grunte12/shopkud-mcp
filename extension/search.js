(() => {
  "use strict";
  const selector='input.ant-input[type="text"][placeholder="ค้นหาสินค้าช้อปปี้ทั้งหมด"]';
  const visible=e=>Boolean(e.getClientRects().length) && !e.disabled;
  const fail=(error,outcome="not_applied")=>({ok:false,error,outcome,retry_automatically:false});
  // The selector is the observed Thai affiliate-page contract, not a guessed API.
  async function run({args,records,selectionStates,active,cancelled,scan}) {
    if(!args || Object.keys(args).some(k=>!["query","start_page","max_pages","max_products"].includes(k))
      || typeof args.query!=="string" || !args.query.trim() || args.query.length>120 || /[\u0000-\u001f]/u.test(args.query)
      || !Number.isInteger(args.start_page) || args.start_page<1 || args.start_page>10000
      || !Number.isInteger(args.max_pages) || args.max_pages<1 || args.max_pages>20
      || !Number.isInteger(args.max_products) || args.max_products<1 || args.max_products>1000)return fail("invalid_input");
    const query=args.query.trim(),route=location.pathname;
    let changed=false,userChanged=false;
    const onUserChange=e=>{if(e.isTrusted)userChanged=true;};
    for(const type of ["pointerdown","input"])document.addEventListener(type,onUserChange,true);
    const stopped=()=>cancelled()?"cancelled":!active() || location.pathname!==route?"page_changed":userChanged?"search_context_changed":
      [...document.querySelectorAll('iframe[src*="captcha"],.captcha,#captcha,[data-testid="captcha"]')].some(visible)?"challenge_detected":null;
    const signature=()=>JSON.stringify(records().map(r=>[r.product_id,r.name]));
    try {
      const deadline=performance.now()+15000;
      let input;
      while(performance.now()<deadline) {
        const stop=stopped();if(stop)return fail(stop);
        const matches=[...document.querySelectorAll(selector)].filter(visible);
        if(matches.length>1)return fail("search_controls_ambiguous");
        if(matches.length===1 && records().length){input=matches[0];break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!input)return fail("search_controls_unavailable");
      const states=selectionStates();
      if(states.some(x=>x===true))return fail("navigation_blocked_by_selections");
      if(states.some(x=>x!==false))return fail("selection_state_unknown");
      const before=signature();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,query);
      changed=true;
      input.dispatchEvent(new Event("input",{bubbles:true}));
      input.dispatchEvent(new Event("change",{bubbles:true}));
      for(const type of ["keydown","keyup"])input.dispatchEvent(new KeyboardEvent(type,{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true}));
      const resultDeadline=performance.now()+15000;
      let stable=0,last=null;
      while(performance.now()<resultDeadline) {
        const stop=stopped();if(stop)return fail(stop,"unconfirmed");
        if(!input.isConnected || input.value!==query)return fail("search_context_changed","unconfirmed");
        const after=signature();
        if(records().length && after!==before){stable=after===last?stable+1:1;last=after;}else stable=0;
        if(stable>=3) {
          const result=await scan({start_page:args.start_page,max_pages:args.max_pages,max_products:args.max_products},()=>Boolean(stopped()));
          return {...result,query,search_source:"native_affiliate_input_enter",search_confirmed:true};
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      return fail("search_result_unconfirmed","unconfirmed");
    } catch {return fail("search_operation_unconfirmed",changed?"unconfirmed":"not_applied");}
    finally {for(const type of ["pointerdown","input"])document.removeEventListener(type,onUserChange,true);}
  }
  window.ShopKudSearch={run};
})();
