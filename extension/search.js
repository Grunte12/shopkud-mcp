(() => {
  "use strict";
  const selector='input.ant-input[type="text"][placeholder="ค้นหาสินค้าช้อปปี้ทั้งหมด"]';
  const visible=e=>Boolean(e.getClientRects().length) && !e.disabled;
  const controls=()=>[...document.querySelectorAll(selector)].filter(visible);
  // Same observed Ant Design loading signal used by pagination. Intermediate
  // rows are not search evidence while the site is still loading.
  const loading=()=>[...document.querySelectorAll(".ant-spin-spinning")].some(visible);
  const fail=(error,outcome="not_applied")=>({ok:false,error,outcome,retry_automatically:false});
  // The selector is the observed Thai affiliate-page contract, not a guessed API.
  async function run({args,records,selectionStates,active,cancelled,scan}) {
    if(!args || Object.keys(args).some(k=>!["query","start_page","max_pages","max_products"].includes(k))
      || typeof args.query!=="string" || !args.query.trim() || args.query.length>120 || /[\u0000-\u001f]/u.test(args.query)
      || !Number.isInteger(args.start_page) || args.start_page<1 || args.start_page>10000
      || !Number.isInteger(args.max_pages) || args.max_pages<1 || args.max_pages>20
      || !Number.isInteger(args.max_products) || args.max_products<1 || args.max_products>1000)return fail("invalid_input");
    const query=args.query.trim(),route=location.pathname;
    let changed=false,userChanged=false,expectedQuery=null,agentEditing=false;
    const onUserChange=e=>{if(e.isTrusted && !agentEditing)userChanged=true;};
    for(const type of ["pointerdown","input"])document.addEventListener(type,onUserChange,true);
    const stopped=()=>{
      if(cancelled())return "cancelled";
      if(!active() || location.pathname!==route)return "page_changed";
      if(userChanged)return "search_context_changed";
      const matches=controls();
      if(expectedQuery!==null && matches.length===1 && matches[0].value.trim()!==expectedQuery)return "search_context_changed";
      return [...document.querySelectorAll('iframe[src*="captcha"],.captcha,#captcha,[data-testid="captcha"]')].some(visible)?"challenge_detected":null;
    };
    const signature=()=>JSON.stringify(records().map(r=>[r.product_id,r.name]));
    try {
      const deadline=performance.now()+30000;
      let input;
      while(performance.now()<deadline) {
        const stop=stopped();if(stop)return fail(stop);
        const matches=controls();
        if(matches.length>1)return fail("search_controls_ambiguous");
        if(matches.length===1 && !loading()){input=matches[0];break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!input)return fail("search_controls_unavailable");
      const states=selectionStates();
      if(states.some(x=>x===true))return fail("navigation_blocked_by_selections");
      if(states.some(x=>x!==false))return fail("selection_state_unknown");
      const searchRoot=input.closest(".ant-input-search,.ant-input-group-wrapper");
      const submitButtons=searchRoot?[...searchRoot.querySelectorAll("button.ant-input-search-button")].filter(visible):[];
      const groupAddons=searchRoot?[...searchRoot.querySelectorAll(".ant-input-group-addon")].filter(visible):[];
      const submitControls=[...submitButtons,...groupAddons];
      if(submitControls.length>1)return fail("search_controls_ambiguous");
      const searchSource=submitButtons.length?"native_affiliate_search_button":groupAddons.length?"native_affiliate_search_addon":"native_affiliate_input_enter";
      const setValue=value=>{
        agentEditing=true;
        try{
          input.focus({preventScroll:true});input.select();
          let applied=false;
          try{applied=document.execCommand("insertText",false,value) && input.value===value;}catch{}
          if(!applied){
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);
            input.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:"insertText",data:value}));
          }
          changed=true;
          input.dispatchEvent(new Event("change",{bubbles:true}));
        }finally{agentEditing=false;}
      };
      const submit=()=>{
        if(submitControls.length)(submitControls[0].firstElementChild || submitControls[0]).click();
        else for(const type of ["keydown","keyup"])input.dispatchEvent(new KeyboardEvent(type,{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true}));
      };
      let before=signature();
      // Repeating the current query can render the same rows. Reset the page first
      // so a fresh live search still has an observable result transition.
      if(input.value.trim()===query && records().length){
        setValue("");submit();
        const resetDeadline=performance.now()+30000;
        let resetConfirmed=false;
        while(performance.now()<resetDeadline){
          const stop=stopped();if(stop)return fail(stop,"unconfirmed");
          const reset=signature();
          if(reset!==before && !loading()){before=reset;resetConfirmed=true;break;}
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        const matches=controls();
        if(matches.length!==1 || matches[0].value!=="" || !resetConfirmed)return fail("search_reset_unconfirmed","unconfirmed");
        input=matches[0];
      }
      setValue(query);expectedQuery=query;submit();
      const resultDeadline=performance.now()+30000;
      let stable=0,last=null;
      while(performance.now()<resultDeadline) {
        const stop=stopped();if(stop)return fail(stop,"unconfirmed");
        const matches=controls();
        if(matches.length>1)return fail("search_controls_ambiguous","unconfirmed");
        if(matches.length===1){
          input=matches[0];
          if(input.value.trim() && input.value.trim()!==query)return fail("search_context_changed","unconfirmed");
        }
        const after=signature();
        if(records().length && after!==before && !loading()){stable=after===last?stable+1:1;last=after;}else stable=0;
        if(stable>=3) {
          const result=await scan({start_page:args.start_page,max_pages:args.max_pages,max_products:args.max_products},()=>Boolean(stopped()));
          const stop=stopped();
          if(stop)return fail(stop,result?.outcome==="not_navigated"?"not_applied":"unconfirmed");
          const finalControls=controls();
          if(finalControls.length!==1 || finalControls[0].value.trim()!==query)return fail("search_context_changed","unconfirmed");
          return {...result,query,search_source:searchSource,search_confirmed:true};
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      return fail("search_result_unconfirmed","unconfirmed");
    } catch {return fail("search_operation_unconfirmed",changed?"unconfirmed":"not_applied");}
    finally {for(const type of ["pointerdown","input"])document.removeEventListener(type,onUserChange,true);}
  }
  window.ShopKudSearch={run};
})();
