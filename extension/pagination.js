(() => {
  "use strict";
  const token=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=node=>!!node && node.getClientRects().length>0 && node.getAttribute("aria-hidden")!=="true";
  const number=node=>{const raw=node?.getAttribute("title") || node?.textContent?.trim();return /^\d{1,5}$/.test(raw || "") && +raw>0 && +raw<=10000?+raw:null;};
  const ROOTS=".ant-pagination,.PaginationNoTotal__wrap";
  const disabled=node=>!node || node.classList.contains("ant-pagination-disabled") || node.classList.contains("disabled") || node.getAttribute("aria-disabled")==="true" || node.querySelector("button")?.disabled===true;
  const failure=(error,extra={})=>({ok:false,error,retry_automatically:false,...extra});
  function inspect() {
    const roots=[...document.querySelectorAll(ROOTS)].filter(visible);
    if(!roots.length)return failure("pagination_not_available");
    const options=roots.map(root=>{
      const ant=root.matches(".ant-pagination");
      const itemsSelector=ant?".ant-pagination-item":".page-item.page-page";
      const active=root.querySelector(ant?".ant-pagination-item-active":".page-item.page-page.active");
      const prev=root.querySelector(ant?".ant-pagination-prev":".page-item.page-prev"),next=root.querySelector(ant?".ant-pagination-next":".page-item.page-next");
      const current_page=number(active);
      return {root,prev,next,itemsSelector,adapter:ant?"ant-pagination":"shopee-pagination-no-total",current_page,has_previous:!disabled(prev),has_next:!disabled(next),
        visible_page_numbers:[...root.querySelectorAll(itemsSelector)].filter(visible).map(number).filter(n=>n!==null)};
    });
    if(options.some(x=>!x.current_page || !x.prev || !x.next))return failure("pagination_markup_unrecognized");
    if(new Set(options.map(x=>JSON.stringify([x.current_page,x.has_previous,x.has_next]))).size!==1)return failure("pagination_ambiguous");
    const x=options[0];
    return {ok:true,...x,total_pages:x.has_next?null:x.current_page};
  }
  function publicState(state=inspect()) {
    if(!state.ok)return state;
    const {root,prev,next,itemsSelector,...safe}=state;return safe;
  }
  function create(deps) {
    const scans=new Map();let revision=0;
    function scope() {
      const q=new URLSearchParams(location.search);
      for(const key of [...q.keys()])if(/^(page|pageNo|pageNum|pageIndex|pageNumber|currentPage)$/i.test(key))q.delete(key);
      q.sort();return JSON.stringify([location.pathname,q.toString(),revision]);
    }
    function interrupted(expected,cancelled=()=>false) {
      if(cancelled())return "cancelled";
      if(!deps.active() || !deps.isOffer())return "page_changed";
      if(scope()!==expected)return "scan_context_changed";
      if([...document.querySelectorAll('iframe[src*="captcha"],.captcha,#captcha,[data-testid="captcha"]')].some(visible))return "challenge_detected";
      return null;
    }
    function selectionsError() {
      const states=deps.selectionStates();
      if(states.some(x=>x===true))return "navigation_blocked_by_selections";
      if(states.some(x=>x!==false))return "selection_state_unknown";
      return null;
    }
    async function step(control,target,expected,deadline,cancelled) {
      const stop=interrupted(expected,cancelled) || selectionsError();if(stop)return failure(stop,{outcome:"not_navigated"});
      if(!visible(control) || disabled(control))return failure("navigation_control_unavailable",{outcome:"not_navigated"});
      const previous=deps.records(),before=JSON.stringify(previous);
      if(!previous.length)return failure("products_not_ready",{outcome:"not_navigated"});
      control.click(); // One observed transition attempt. Never click again on timeout.
      let stable=0,last="";
      const until=Math.min(deadline,performance.now()+5000);
      while(performance.now()<until) {
        const stop=interrupted(expected,cancelled);if(stop)return failure(stop,{outcome:"unconfirmed"});
        const state=inspect(),records=deps.records();
        const signature=JSON.stringify(records);
        const loading=[...document.querySelectorAll(".ant-spin-spinning")].some(visible);
        if(state.ok && state.current_page===target && records.length && signature!==before && !loading) {
          stable=signature===last?stable+1:1;last=signature;
          if(stable>=2){deps.invalidatePlans();return {ok:true,current_page:target,outcome:"completed"};}
        } else {stable=0;last="";}
        await sleep(100);
      }
      return failure("page_change_unconfirmed",{outcome:"unconfirmed",current_page:publicState().current_page ?? null});
    }
    async function navigate(target,expected=scope(),deadline=performance.now()+15000,cancelled=()=>false) {
      if(!Number.isInteger(target) || target<1 || target>10000)return failure("invalid_input");
      let moved=false;
      for(let hop=0;hop<20;hop++) {
        const stop=interrupted(expected,cancelled);if(stop)return failure(stop,{outcome:moved?"partial":"not_navigated",current_page:publicState().current_page ?? null});
        const state=inspect();if(!state.ok)return {...state,outcome:moved?"partial":"not_navigated",current_page:null};
        if(state.current_page===target)return {ok:true,current_page:target,outcome:moved?"completed":"unchanged"};
        if(performance.now()>=deadline)return failure("navigation_budget_exhausted",{outcome:moved?"partial":"not_navigated",current_page:state.current_page});
        const exact=[...state.root.querySelectorAll(state.itemsSelector)].filter(node=>visible(node) && number(node)===target);
        if(exact.length>1)return failure("pagination_ambiguous",{outcome:moved?"partial":"not_navigated",current_page:state.current_page});
        let control=exact[0],next=target;
        if(!control){const forward=target>state.current_page;control=forward?state.next:state.prev;next=state.current_page+(forward?1:-1);}
        const result=await step(control,next,expected,deadline,cancelled);if(!result.ok)return moved && result.outcome==="not_navigated"?{...result,outcome:"partial",current_page:publicState().current_page ?? null}:result;moved=true;
        if(result.current_page===target)return result;
      }
      return failure("navigation_hop_limit",{outcome:moved?"partial":"not_navigated",current_page:publicState().current_page ?? null});
    }
    function prune() {
      for(const [id,s] of scans)if(Date.now()-s.created>600000)scans.delete(id);
      while(scans.size>=4)scans.delete(scans.keys().next().value);
    }
    async function scan(args,cancelled=()=>false) {
      if(!Number.isInteger(args.start_page) || args.start_page<1 || args.start_page>10000 || !Number.isInteger(args.max_pages) || args.max_pages<1 || args.max_pages>20 || !Number.isInteger(args.max_products) || args.max_products<1 || args.max_products>1000)return failure("invalid_input");
      const start=inspect();if(!start.ok)return start;
      const selection=selectionsError();if(selection)return failure(selection,{outcome:"not_navigated"});
      const expected=scope(),deadline=performance.now()+60000;
      const seek=await navigate(args.start_page,expected,deadline,cancelled);if(!seek.ok)return seek;
      const unique=new Map(),conflicts=new Set(),seen=new Set();let duplicates=0,pages=0,stop_reason="page_limit",reached_end=false,unknown=false,truncatedPage=false;
      while(pages<args.max_pages && performance.now()<deadline) {
        const stop=interrupted(expected,cancelled);if(stop){stop_reason=stop;unknown=true;break;}
        const state=inspect();if(!state.ok){stop_reason=state.error;unknown=true;break;}
        const records=deps.records();
        const signature=JSON.stringify(records.map(x=>x.product_id));
        if(!records.length){stop_reason="products_not_ready";unknown=true;break;}
        if(seen.has(signature)){stop_reason="repeated_page";unknown=true;break;}seen.add(signature);
        let truncated=false;
        for(const record of records) {
          const old=unique.get(record.product_id);
          if(old){duplicates++;if(JSON.stringify(old.record)!==JSON.stringify(record))conflicts.add(record.product_id);continue;}
          if(unique.size>=args.max_products){truncated=true;break;}
          unique.set(record.product_id,{record,page_number:state.current_page});
        }
        pages++;
        if(truncated){truncatedPage=true;stop_reason="product_limit";break;}
        if(!state.has_next){stop_reason="end_of_results";reached_end=true;break;}
        if(unique.size>=args.max_products){stop_reason="product_limit";break;}
        if(pages>=args.max_pages)break;
        const next=await navigate(state.current_page+1,expected,deadline,cancelled);
        if(!next.ok){stop_reason=next.error;unknown=true;break;}
      }
      if(performance.now()>=deadline && !reached_end){stop_reason="time_budget";unknown=true;}
      if(scope()!==expected || !deps.active())return failure("scan_context_changed",{pages_scanned:pages,outcome:unknown?"unconfirmed":"partial"});
      prune();const scan_id=token();
      scans.set(scan_id,{created:Date.now(),scope:expected,records:[...unique.values()],conflicts:[...conflicts]});
      const end=publicState();
      return {ok:!unknown,scan_id,pages_scanned:pages,unique_products:unique.size,duplicates_removed:duplicates,
        conflicted_product_ids:[...conflicts].slice(0,100),reached_end,stop_reason,current_page:end.current_page ?? null,
        next_page:end.ok && end.has_next?end.current_page+1:null,expires_in_seconds:600,
        resume_page:unknown?null:truncatedPage?end.current_page:end.ok && end.has_next?end.current_page+1:null,
        leaves_browser_on_last_observed_page:true,retry_automatically:false,selection_snapshot:false,
        outcome:unknown?"unconfirmed":reached_end?"completed":"partial"};
    }
    function read(args) {
      if(!/^[0-9a-f]{32}$/.test(args.scan_id || "") || !Number.isInteger(args.limit) || args.limit<1 || args.limit>50 || !Number.isInteger(args.offset) || args.offset<0 || args.offset>999)return failure("invalid_input");
      const query=args.query===undefined?"":args.query,view=args.view===undefined?"full":args.view;
      if(typeof query!=="string" || [...query].length>120 || !["full","brief"].includes(view))return failure("invalid_input");
      const s=scans.get(args.scan_id);
      if(!s || Date.now()-s.created>600000)return failure("scan_expired_or_unknown");
      if(scope()!==s.scope)return failure("scan_context_changed");
      const normalize=text=>text.normalize("NFKC").toLowerCase();
      const terms=normalize(query).trim().split(/\s+/u).filter(Boolean);
      const matches=terms.length?s.records.filter(x=>{const haystack=normalize(`${x.record.name || ""} ${x.record.product_id}`);return terms.every(term=>haystack.includes(term));}):s.records;
      const part=matches.slice(args.offset,args.offset+args.limit);
      const briefKeys=["product_id","name","price_min_thb","commission_pct","sold","mall","extra_comm"];
      return {ok:true,scan_id:args.scan_id,records:part.map(x=>({... (view==="brief"?Object.fromEntries(briefKeys.map(key=>[key,x.record[key] ?? null])):x.record),page_ref:{page_number:x.page_number},conflicting_observation:s.conflicts.includes(x.record.product_id)})),
        query,view,observed_at:new Date(s.created).toISOString(),unfiltered_total:s.records.length,total:matches.length,offset:args.offset,next_offset:args.offset+part.length<matches.length?args.offset+part.length:null,
        selection_snapshot:false,requires_fresh_page_snapshot_before_selection:true};
    }
    function userChange(event) {
      if(!event.isTrusted || deps.isOwnUI(event))return;
      revision++;deps.invalidatePlans(); // no input values, text, cookies or credentials read
    }
    document.addEventListener("pointerdown",userChange,true);
    document.addEventListener("input",userChange,true);
    document.addEventListener("keydown",event=>{if(["Enter"," ","ArrowLeft","ArrowRight"].includes(event.key) && event.target?.closest?.(ROOTS))userChange(event);},true);
    return {inspect:publicState,navigate,scan,read,reset:()=>{revision++;scans.clear();}};
  }
  window.ShopKudPagination={create};
})();
