const LEARN_KEY=DWStore.KEYS.LEARN;
let learnProgress=DWStore.read(LEARN_KEY,{});
DWStore.onMigrated(()=>{learnProgress=DWStore.read(LEARN_KEY,{})});
let ZH={};
let learnQueue=[],learnPos=0,learnCorrect=0,learnAnswered=false,learnRoundNew=0;
const L$=id=>document.getElementById(id);
const Lesc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const Lnorm=s=>(s||"").toLowerCase().trim().replace(/[|·.,;:!?()[\]{}“”„"']/g," ").replace(/\s+/g," ").replace(/ß/g,"ss");
const LwithoutArticle=s=>Lnorm(s).replace(/^(der|die|das)\s+/,"");
const LisNoun=c=>/^(der|die|das)\s/i.test(c.de);
const Lclean=s=>(s||"").replace(/^[_\-–—\s]+/,"").replace(/\s*\([^)]*\)\s*$/," ").trim();
const Lshuffle=a=>a.map(v=>({v,r:Math.random()})).sort((a,b)=>a.r-b.r).map(x=>x.v);
const LDE_CHARS=["ä","ö","ü","ß","Ä","Ö","Ü"];
// German pronunciation was reachable only from the very first screen of a new
// word. It matters most right after an answer is revealed, while the form is
// still in mind, so the button is a shared component now.
function LspeakBtn(text,label="🔊"){return text?`<button type="button" class="speakBtn" data-say="${Lesc(text)}" aria-label="朗读 ${Lesc(text)}">${label}</button>`:""}
document.addEventListener("click",e=>{const b=e.target.closest(".speakBtn");if(!b)return;e.preventDefault();Lspeak(b.dataset.say)});
function LhasGermanVoice(){if(!("speechSynthesis" in window))return false;const v=speechSynthesis.getVoices();return !v.length||v.some(x=>/^de/i.test(x.lang))}
if("speechSynthesis" in window)speechSynthesis.addEventListener?.("voiceschanged",()=>{LloadVoices();LrenderVoicePicker()});
function LcharBar(target){return `<div class="charBar" data-target="${target}">${LDE_CHARS.map(ch=>`<button type="button" class="charKey" data-ch="${ch}">${ch}</button>`).join("")}</div>`}
document.addEventListener("click",e=>{const k=e.target.closest(".charKey");if(!k)return;e.preventDefault();const bar=k.closest(".charBar"),input=document.getElementById(bar.dataset.target);if(!input)return;const s=input.selectionStart??input.value.length,t=input.selectionEnd??s;input.value=input.value.slice(0,s)+k.dataset.ch+input.value.slice(t);const p=s+k.dataset.ch.length;input.setSelectionRange(p,p);input.focus()});
function Lstate(c){return learnProgress[c.id]||{introduced:false,strength:0,wrong:0,hard:0,last:0,due:0,spellingPass:false,cycles:0,known:false}}
function Lsave(c,s){learnProgress[c.id]=s;DWStore.queue(LEARN_KEY,()=>learnProgress);Lstats();LhomeStats()}
function Lmeaning(c){return ZH[c.id]||Lclean(c.en)}
function Lenglish(c){return Lclean(c.en)}
function LhasZh(c){return !!ZH[c.id]}
function LmeaningMeta(c){return LhasZh(c)&&Lenglish(c)?`英文：${Lenglish(c)}`:""}
function LallLearningCards(){return CARDS}
function Lscope(){const level=L$("learnLevel")?.value||"A1",chapter=L$("learnChapter")?.value||"1";return {level,chapter}}
function LscopeLabel(){const s=Lscope();return `${s.level} Kapitel ${s.chapter}`}
function Lcards(){const s=Lscope();return LallLearningCards().filter(c=>c.level===s.level&&String(c.chapter)===String(s.chapter))}
function LsetSpelling(v){learnSpelling=!!v;DWStore.prefs({spelling:learnSpelling});
 for(const id of ["learnSpellToggle","homeSpellToggle"]){const el=L$(id);if(el&&el.checked!==learnSpelling)el.checked=learnSpelling}
 LspellNote();Llanding();LupdateToday()}
function LspellNote(){const n=L$("learnSpellNote");if(n)n.innerHTML=learnSpelling
 ? "每组 5 个词：认识 → 看德语认意思 → 看意思认德语 → 拼写。"
 : "<b>已关闭拼写</b>：只做前几层，复习间隔照常推进，但这些词<b>不会进入「已掌握」</b> —— 打开拼写再过一轮才会。";
 const h=L$("homeSpellHint");if(h)h.textContent=learnSpelling?"":"已关闭拼写 · 只快速过一遍"}
function Llanding(message=""){if(!L$("learnBody"))return;learnQueue=[];learnPos=0;L$("learnBar").style.width="0%";L$("learnBadge").textContent="零基础学习模式";const cs=Lcards();L$("learnBody").innerHTML=`<div class="sessionDone"><div class="big">📖</div><h2>${Lesc(LscopeLabel())}</h2><p class="sub">${message||`当前章节 ${cs.length} 个词。每 5 个新词做一次小复习：认识 → 看德语认意思 → 看意思认德语${learnSpelling?" → 最后才拼写":"（本轮不拼写）"}。`}</p></div>`;L$("learnFeedback").className="feedback";L$("learnNextBtn").style.display="none"}
// Reopening the app used to land on A1 Kapitel 1 whatever you were working on.
function Lcoverage(cards){const cov=L$("learnCoverage");if(!cov)return;const by=new Map();for(const c of cards)by.set(c.level,(by.get(c.level)||0)+1);const name=(window.__deck&&window.__deck.name)||"\u6211\u7684\u8bcd\u5e93";cov.innerHTML=`<b>\u5f53\u524d\u8bcd\u5e93\uff1a${Lesc(name)} \u00b7 \u5171 ${cards.length} \u4e2a\u8bcd\u6761\u3002</b> ${[...by.keys()].sort(LcmpLevel).map(l=>`${Lesc(l)} ${by.get(l)}`).join(" \u00b7 ")}\u3002\u7ae0\u8282\u4e4b\u95f4\u7684\u5b66\u4e60\u8fdb\u5ea6\u5f7c\u6b64\u72ec\u7acb\uff1b\u4ee5\u540e\u66f4\u6362\u8bcd\u5e93\u4e5f\u4e0d\u4f1a\u6e05\u7a7a\u5df2\u7ecf\u5b66\u8fc7\u7684\u8bcd\u3002`}
const LcmpLevel=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:"base"});
function LlevelChoices(){return `<option value="ALL">全部级别</option>`+[...new Set(LallLearningCards().map(c=>c.level))].sort(LcmpLevel).map(l=>`<option value="${Lesc(l)}">${Lesc(l)}</option>`).join("")}
function LsyncLevels(){const lv=L$("learnLevel");if(!lv)return;const prev=lv.value,ls=[...new Set(LallLearningCards().map(c=>c.level))].sort(LcmpLevel);lv.innerHTML=ls.map(l=>`<option value="${Lesc(l)}">${Lesc(l)}</option>`).join("");if(ls.includes(prev))lv.value=prev}
function LrestoreScope(){LsyncLevels();const p=DWStore.prefs(),lv=L$("learnLevel");
 if(p.level&&lv&&[...lv.options].some(o=>o.value===p.level))lv.value=p.level;
 LsyncChapters();
 const ch=L$("learnChapter");
 if(p.chapter&&ch&&[...ch.options].some(o=>o.value===String(p.chapter))){ch.value=String(p.chapter);Lstats();Llanding()}}
function LsyncChapters(){if(!L$("learnLevel")||!L$("learnChapter"))return;const level=L$("learnLevel").value,prev=L$("learnChapter").value,chs=[...new Set(LallLearningCards().filter(c=>c.level===level).map(c=>String(c.chapter)))].sort(LcmpLevel);L$("learnChapter").innerHTML=chs.map(ch=>`<option value="${ch}">Kapitel ${ch}</option>`).join("");if(chs.includes(prev))L$("learnChapter").value=prev;Lstats();Llanding()}
const LTODAY_REVIEW_CAP=40;
let learnSpelling=DWStore.prefs().spelling!==false;
let learnToday=false;
function LdueCards(){const now=Date.now();return LallLearningCards().filter(c=>{const s=Lstate(c);return s.introduced&&!Lmastered(s)&&(s.due||0)<=now}).sort((a,b)=>(Lstate(a).due||0)-(Lstate(b).due||0))}
function LfreshCards(n){const out=[];for(const c of LallLearningCards()){if(out.length>=n)break;const s=Lstate(c);if(!s.introduced&&!s.known)out.push(c)}return out}
function LtodayPlan(){const due=LdueCards();return {due,take:due.slice(0,LTODAY_REVIEW_CAP),fresh:LfreshCards(+((L$("learnCount")||{}).value||10))}}
function LstartToday(){const plan=LtodayPlan();if(!plan.take.length&&!plan.fresh.length){alert("今天没有到期的词，新词也学完了。");return}
learnToday=true;learnQueue=LmakeQueue(plan.take,true).concat(LmakeQueue(plan.fresh,false));learnPos=0;learnCorrect=0;learnAnswered=false;learnRoundNew=plan.fresh.length;
Lshow("learn");Lrender();Lbring(L$("learnCard"),"start")}
function LupdateToday(){const btn=L$("goToday");if(!btn||typeof CARDS==="undefined"||!CARDS.length)return;const plan=LtodayPlan();const n=plan.take.length+plan.fresh.length;
L$("todayCount").textContent=n;L$("todayBreak").textContent=n?`${plan.take.length} 个到期复习 + ${plan.fresh.length} 个新词${plan.due.length>plan.take.length?`（还有 ${plan.due.length-plan.take.length} 个到期，下一轮继续）`:""}`:"今天没有到期的词，新词也学完了。";btn.disabled=!n}
function Lmastered(s){return !!s.known||((s.cycles||0)>=3&&(s.strength||0)>=5&&!!s.spellingPass)}
function Linterval(s){const c=s.cycles||0;if(c<=0)return 10*60*1000;if(c===1)return 24*60*60*1000;if(c===2)return 3*24*60*60*1000;return 14*24*60*60*1000}
function Lbring(el,block="nearest"){if(!el)return;requestAnimationFrame(()=>{const r=el.getBoundingClientRect(),vh=innerHeight||document.documentElement.clientHeight;if(r.top<8||r.bottom>vh-8){try{el.scrollIntoView({behavior:"smooth",block})}catch(e){el.scrollIntoView()}}})}
function Lstats(){if(!L$("lNew"))return;const cs=Lcards(),now=Date.now();let fresh=0,learning=0,due=0,mastered=0;for(const c of cs){const s=Lstate(c);if(!s.introduced&&!s.known)fresh++;else if(Lmastered(s))mastered++;else{learning++;if((s.due||0)<=now)due++}}L$("lNew").textContent=fresh;L$("lLearning").textContent=learning;L$("lDue").textContent=due;L$("lMastered").textContent=mastered}
function LhomeStats(){if(!L$("homeLearning"))return;const cs=LallLearningCards(),now=Date.now();let learning=0,due=0,mastered=0;for(const c of cs){const s=Lstate(c);if(Lmastered(s))mastered++;else if(s.introduced){learning++;if((s.due||0)<=now)due++}}L$("homeLearning").textContent=learning;L$("homeDue").textContent=due;L$("homeMastered").textContent=mastered;L$("homeQuizWeak").textContent=Object.values(progress).filter(s=>s.wrong>0&&s.mastery<4).length;LupdateToday()}
function Lshow(name){L$("homeView").classList.toggle("hidden",name!=="home");L$("learnView").classList.toggle("hidden",name!=="learn");L$("quizView").classList.toggle("hidden",name!=="quiz");L$("modeBack").classList.toggle("hidden",name==="home");const sub=document.querySelector(".wrap > .sub");if(sub)sub.textContent=name==="learn"?"零基础背词：先懂意思，再主动回忆。":name==="quiz"?"单词检测：检查你已经学过的词。":"从认识单词到真正记住。";window.scrollTo({top:0,behavior:"smooth"});if(name==="home")LhomeStats();if(name==="learn")Lstats()}
function LmakeQueue(cards,review=false){const q=[],groupSize=5;for(let i=0;i<cards.length;i+=groupSize){const g=cards.slice(i,i+groupSize);if(!review)g.forEach(c=>q.push({type:"intro",c}));Lshuffle(g).forEach(c=>q.push({type:"recognize",c}));Lshuffle(g).forEach(c=>q.push({type:"reverse",c}));if(learnSpelling)Lshuffle(g).forEach(c=>q.push({type:"spell",c}))}return q}
function Lstart(review=false){learnToday=false;const cs=Lcards(),now=Date.now();let selected;if(review){selected=cs.filter(c=>{const s=Lstate(c);return s.introduced&&!Lmastered(s)&&(s.due||0)<=now});if(!selected.length){alert(`${LscopeLabel()} 现在没有到期需要复习的词。可以继续学新词。`);return}selected=selected.slice(0,Math.max(5,+L$("learnCount").value));learnRoundNew=0}else{selected=cs.filter(c=>{const s=Lstate(c);return !s.introduced&&!s.known}).slice(0,+L$("learnCount").value);if(!selected.length){alert(`${LscopeLabel()} 的新词已经学完了，可以复习到期词，或者切换章节。`);return}learnRoundNew=selected.length}learnQueue=LmakeQueue(selected,review);learnPos=0;learnCorrect=0;learnAnswered=false;Lrender();Lbring(L$("learnCard"),"start")}
function Llabel(type){return type==="intro"?"认识新词":type==="recognize"?"第 1 层 · 看德语懂意思":type==="reverse"?"第 2 层 · 看意思认出德语":"第 3 层 · 主动拼写"}
function Ldistractors(c,count=3,labelOf=Lmeaning){const seen=new Set([c.id]),labels=new Set([Lnorm(labelOf(c))]),cs=[];
const take=x=>{if(seen.has(x.id))return false;const l=Lnorm(labelOf(x));if(!l||labels.has(l))return false;seen.add(x.id);labels.add(l);cs.push(x);return true};
for(const t of learnQueue){if(cs.length>=count)break;if(Lstate(t.c).introduced)take(t.c)}
const near=LallLearningCards().filter(x=>x.level===c.level&&String(x.chapter)===String(c.chapter));
if(cs.length<count)for(const x of near){if(cs.length>=count)break;if(Lstate(x).introduced)take(x)}
if(cs.length<count)for(const x of near){if(cs.length>=count)break;take(x)}
const sameLevel=LallLearningCards().filter(x=>x.level===c.level);
if(cs.length<count)for(const x of sameLevel){if(cs.length>=count)break;take(x)}
if(cs.length<count)for(const x of LallLearningCards()){if(cs.length>=count)break;take(x)}
return Lshuffle(cs).slice(0,count)}
function Ldetails(c){return `${c.grammar?`<div class="grammarBox"><b>词形信息</b><br>${Lesc(c.grammar)}</div>`:""}${c.example?`<div class="example"><b>例句</b><br>${Lesc(c.example)}</div>`:""}`}
function Lrender(){const fb=L$("learnFeedback");fb.className="feedback";fb.innerHTML="";L$("learnNextBtn").style.display="none";learnAnswered=false;if(learnPos>=learnQueue.length)return Lfinish();const t=learnQueue[learnPos],c=t.c;L$("learnBadge").textContent=`${Llabel(t.type)} · ${learnPos+1}/${learnQueue.length}`;L$("learnBar").style.width=`${Math.round(learnPos/learnQueue.length*100)}%`;if(t.type==="intro")Lintro(c);else if(t.type==="recognize")Lrecognize(c);else if(t.type==="reverse")Lreverse(c);else Lspell(c)}
function Lintro(c){L$("learnBody").innerHTML=`<div class="phaseTitle">先建立第一印象：今天不要求你一上来就默写。</div><div class="learnWord">${Lesc(c.de)}</div><div class="learnZh">${Lesc(Lmeaning(c))}</div><div class="learnEn">${Lesc(LmeaningMeta(c))}</div>${Ldetails(c)}<div class="learnActions"><button class="secondary" id="learnSpeak">🔊 发音</button><button class="secondary" id="learnHard">😵 很难记</button><button class="primary" id="learnRemember">记住了，继续</button><button class="secondary" id="learnKnown">这个我已经会</button></div><div class="sourceNote">发音优先使用真人录音，没有录音时用设备的德语 TTS；词形、语法信息和例句来自你导入的词库。</div>`;L$("learnSpeak").onclick=()=>Lspeak(c.de);L$("learnRemember").onclick=()=>LintroDone(c,false,false);L$("learnHard").onclick=()=>LintroDone(c,true,false);L$("learnKnown").onclick=()=>LintroDone(c,false,true)}
function LintroDone(c,hard,known){const s=Lstate(c);s.introduced=true;s.last=Date.now();if(known){s.known=true;s.strength=5;s.spellingPass=true;s.cycles=3;s.due=Date.now()+30*24*60*60*1000;learnQueue=learnQueue.filter((t,i)=>i<=learnPos||t.c.id!==c.id)}else if(hard){s.hard=(s.hard||0)+1;s.strength=0;s.due=Date.now()}else{s.strength=Math.max(1,s.strength||0);s.due=Date.now()}Lsave(c,s);learnPos++;Lrender()}
function Lrecognize(c){const opts=Lshuffle([c,...Ldistractors(c)]);L$("learnBody").innerHTML=`<div class="phaseTitle">这个德语词是什么意思？</div><div class="wordRow"><div class="learnWord">${Lesc(c.de)}</div>${LspeakBtn(c.de)}</div><div class="choiceGrid">${opts.map(x=>`<button class="choice" data-id="${Lesc(x.id)}">${Lesc(Lmeaning(x))}${LhasZh(x)?`<div class="small">${Lesc(Lenglish(x))}</div>`:""}</button>`).join("")}</div>`;document.querySelectorAll("#learnBody .choice").forEach(b=>b.onclick=()=>Lchoice(c,b.dataset.id,c.id,"recognize"))}
function Lreverse(c){const opts=Lshuffle([c,...Ldistractors(c,3,x=>x.de)]);L$("learnBody").innerHTML=`<div class="phaseTitle">看到意思，先认出正确的德语。</div><div class="learnZh">${Lesc(Lmeaning(c))}</div><div class="learnEn">${LhasZh(c)?Lesc(Lenglish(c)):""}</div><div class="choiceGrid">${opts.map(x=>`<button class="choice" data-id="${Lesc(x.id)}">${Lesc(x.de)}</button>`).join("")}</div>`;document.querySelectorAll("#learnBody .choice").forEach(b=>b.onclick=()=>Lchoice(c,b.dataset.id,c.id,"reverse"))}
function Lchoice(c,picked,expected,type){if(learnAnswered)return;learnAnswered=true;const ok=picked===expected;document.querySelectorAll("#learnBody .choice").forEach(b=>{b.disabled=true;if(b.dataset.id===expected)b.classList.add("correct");else if(b.dataset.id===picked)b.classList.add("wrong")});Lrecord(c,ok,type);Lfeedback(c,ok);L$("learnNextBtn").style.display="";Lbring(L$("learnNextBtn"),"end")}
function Lspell(c){L$("learnBody").innerHTML=`<div class="phaseTitle">最后才进入主动回忆。名词第一次不用强求冠词完全正确，系统会把完整形式再展示给你。</div><div class="learnZh">${Lesc(Lmeaning(c))}</div><div class="learnEn">${LhasZh(c)?Lesc(Lenglish(c)):""}</div><div class="answerBox" style="margin-top:18px"><input id="learnAnswer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="输入德语…"><button class="primary" id="learnSubmit">检查</button><button class="secondary" id="learnShow">不会 / 看答案</button></div>${LcharBar("learnAnswer")}`;const input=L$("learnAnswer");L$("learnSubmit").onclick=()=>{input.blur();LcheckSpell(c,false)};L$("learnShow").onclick=()=>{input.blur();LcheckSpell(c,true)};input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();input.blur();LcheckSpell(c,false)}});setTimeout(()=>{try{input.focus({preventScroll:true})}catch(e){input.focus()}},80)}
function LspellAccepted(c,input){const a=Lnorm(input),t=Lnorm(c.de);if(a===t)return true;if(LisNoun(c)&&LwithoutArticle(a)===LwithoutArticle(t))return true;return a.replace(/\s/g,"")===t.replace(/\s/g,"")}
function LcheckSpell(c,show){if(learnAnswered)return;const input=L$("learnAnswer"),v=input.value.trim();if(!show&&!v)return;learnAnswered=true;const ok=!show&&LspellAccepted(c,v);LwrongSpellResult(c,v,show,ok);Lrecord(c,ok,"spell");Lfeedback(c,ok);L$("learnSubmit").disabled=L$("learnShow").disabled=true;L$("learnNextBtn").style.display="";Lbring(L$("learnNextBtn"),"end")}
const LAPSE_MS=10*60*1000;
function Lrecord(c,ok,type){const s=Lstate(c);s.introduced=true;s.last=Date.now();if(ok){learnCorrect++;if(type==="spell"){s.strength=Math.min(5,(s.strength||0)+2);s.spellingPass=true;s.cycles=(s.cycles||0)+1}else{s.strength=Math.min(5,(s.strength||0)+1);if(!learnSpelling&&type==="reverse")s.cycles=(s.cycles||0)+1}s.due=Date.now()+Linterval(s)}else{s.wrong=(s.wrong||0)+1;s.lapses=(s.lapses||0)+1;s.strength=Math.max(0,(s.strength||0)-1);s.cycles=Math.max(0,(s.cycles||0)-1);if(type==="spell")s.spellingPass=false;s.known=false;s.due=Date.now()+LAPSE_MS}Lsave(c,s)}
function Lfeedback(c,ok){const s=Lstate(c),fb=L$("learnFeedback");fb.className="feedback show "+(ok?"ok":"no");fb.innerHTML=`<b>${ok?"✓ 对了":"✗ 这次先记住它"}</b><div class="answerRow"><div class="deAnswer">${Lesc(c.de)}</div>${LspeakBtn(c.de)}</div><div>${Lesc(Lmeaning(c))} <span class="meta">· ${Lesc(Lenglish(c))}</span></div>${Ldetails(c)}<div class="meta" style="margin-top:8px">当前掌握度：${Math.min(5,s.strength||0)}/5 · 记忆轮次 ${Math.min(3,s.cycles||0)}/3${s.spellingPass?" · 已通过拼写":""}</div>`}
function Lfinish(){L$("learnBar").style.width="100%";const total=learnQueue.filter(x=>x.type!=="intro").length,pct=total?Math.round(learnCorrect/total*100):100;L$("learnBadge").textContent=learnToday?"今日任务 · 本轮完成":"本轮完成";L$("learnBody").innerHTML=`<div class="sessionDone"><div class="big">🎉</div><h2>${learnToday?"今日任务":Lesc(LscopeLabel())} · 本轮完成</h2><p class="sub">${learnRoundNew?`新认识 ${learnRoundNew} 个词。`:"完成了一轮到期复习。"} 练习正确率 ${pct}% 。一个词需要经过 3 个记忆轮次（约 1 天、3 天的间隔复习）才计入“已掌握”。${learnSpelling?"":"本轮关闭了拼写，所以这些词不会计入“已掌握”。"}</p><div class="learnActions">${learnToday?`<button class="primary" id="learnAgainToday">继续今日任务</button>`:""}<button class="${learnToday?"secondary":"primary"}" id="learnAgainNew">继续学新词</button><button class="secondary" id="learnAgainReview">看看到期词</button></div></div>`;L$("learnAgainNew").onclick=()=>Lstart(false);L$("learnAgainReview").onclick=()=>Lstart(true);const again=L$("learnAgainToday");if(again)again.onclick=()=>LstartToday();L$("learnFeedback").className="feedback";L$("learnNextBtn").style.display="none";Lstats();LhomeStats()}
// Only the language was set, never the voice, so the browser fell back to its
// default German one — on Apple devices the old compact "Anna". Devices usually
// carry better voices than the default; they just have to be asked for.
let LvoicesDe=[];
function LloadVoices(){LvoicesDe=("speechSynthesis" in window)?speechSynthesis.getVoices().filter(v=>/^de/i.test(v.lang||"")):[];return LvoicesDe}
function LvoiceRank(v){const n=`${v.name||""}`;let s=0;
 if(/premium/i.test(n))s+=100;
 if(/enhanced|neural|natural|siri/i.test(n))s+=80;
 if(/google/i.test(n))s+=60;
 if(v.localService===false)s+=30;
 if(/^de-DE$/i.test(v.lang||""))s+=10;
 if(/compact|eloquence/i.test(n))s-=50;
 return s}
function LvoiceQuality(v){const n=`${(v&&v.name)||""}`;
 if(/premium|enhanced|neural|natural|siri|google/i.test(n))return "good";
 if(/compact|eloquence/i.test(n))return "basic";
 return "unknown"}
function LvoiceIsGood(v){return LvoiceQuality(v)==="good"}
function LbestVoice(){const list=LvoicesDe.length?LvoicesDe:LloadVoices();if(!list.length)return null;
 const want=DWStore.prefs().voice,pick=want&&list.find(v=>(v.voiceURI||v.name)===want);
 return pick||list.slice().sort((a,b)=>LvoiceRank(b)-LvoiceRank(a))[0]}
// Recorded German pronunciations from Wikimedia Commons, used in preference to
// speech synthesis: about 92% of this deck has one, they are native speakers, and
// they play on devices whose system has no German voice at all — which is the
// case on Chinese Android ROMs, where Google's engine cannot be installed.
// Anything that fails falls back to synthesis, so the button always does something.
const LAUDIO_CACHE="deutsch-woerter-audio";
const LMISS_KEY="netzwerk_vocab_audio_miss_v1";
const LMISS_TTL=30*24*60*60*1000;
let LaudioMiss=DWStore.read(LMISS_KEY,{});
DWStore.onMigrated(()=>{LaudioMiss=DWStore.read(LMISS_KEY,{})});
const LaudioWord=t=>String(t||"").replace(/^(der|die|das)\s+/i,"").trim();
function LaudioUrl(text){const w=LaudioWord(text);
 if(!/^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{1,}$/.test(w))return null;
 const file=`De-${w}.ogg`,h=Lmd5(file),e=encodeURIComponent(file);
 return `https://upload.wikimedia.org/wikipedia/commons/transcoded/${h[0]}/${h.slice(0,2)}/${e}/${e}.mp3`}
function LaudioCredit(text){const w=LaudioWord(text);return `https://commons.wikimedia.org/wiki/File:De-${encodeURIComponent(w)}.ogg`}
function LaudioSkip(text){const t=LaudioMiss[LaudioWord(text)];return !!t&&Date.now()-t<LMISS_TTL}
function LaudioMark(text){LaudioMiss[LaudioWord(text)]=Date.now();DWStore.queue(LMISS_KEY,()=>LaudioMiss)}
let LaudioEl=null;
async function LplayRecorded(text){
 if(DWStore.prefs().recorded===false)return false;
 const url=LaudioUrl(text);
 if(!url||LaudioSkip(text)||!("caches" in window))return false;
 try{
  const cache=await caches.open(LAUDIO_CACHE);
  let res=await cache.match(url);
  if(!res){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),2500);
   try{res=await fetch(url,{mode:"cors",signal:ctrl.signal})}finally{clearTimeout(timer)}
   if(!res.ok){if(res.status===404)LaudioMark(text);return false}
   await cache.put(url,res.clone())}
  const src=URL.createObjectURL(await res.blob());
  if(LaudioEl){LaudioEl.pause();URL.revokeObjectURL(LaudioEl.src)}
  LaudioEl=new Audio(src);
  LaudioEl.onended=()=>URL.revokeObjectURL(src);
  await LaudioEl.play();
  return true;
 }catch(e){return false}}
function Lsynth(text){if(!("speechSynthesis" in window)){alert("当前浏览器没有可用的语音朗读功能。");return}
 speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);
 const v=LbestVoice();if(v)u.voice=v;
 u.lang=(v&&v.lang)||"de-DE";u.rate=+(DWStore.prefs().rate||0.85);
 speechSynthesis.speak(u)}
async function Lspeak(text){if(await LplayRecorded(text))return;Lsynth(text)}
function LvoiceAdvice(){const ua=navigator.userAgent||"";
 if(/iPhone|iPad|iPod/i.test(ua))return "设置 → 辅助功能 → 朗读内容 → 声音 → 德语，下载「增强」或「优质」版本。";
 if(/Macintosh/i.test(ua))return "系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音 → 德语，下载增强版。";
 if(/Android/i.test(ua))return "设置 → 系统 → 语言与输入法 → 文字转语音输出，引擎选「Google 文字转语音」，再进「安装语音数据」下载德语。三星等机型默认用自家引擎，常常没有德语，换成 Google 的即可。";
 return "装一个德语增强语音包，或换用 Chrome（有 Google Deutsch 在线语音）。"}
function LrecordedNote(){const n=L$("recordedNote");if(!n)return;
 n.innerHTML=DWStore.prefs().recorded===false
  ? "已关闭，只用设备语音合成。"
  : '德语母语者录音，来自 <a href="https://commons.wikimedia.org/wiki/Category:German_pronunciation" target="_blank" rel="noopener">Wikimedia Commons</a>（CC 授权）。约 9 成词条有录音，没有的自动用设备语音；听过的会缓存，之后离线也能播。'}
function LrenderVoicePicker(){const sel=L$("voicePick");if(!sel)return;
 const list=LloadVoices(),cur=LbestVoice();
 if(!list.length){sel.innerHTML='<option>没有德语语音</option>';sel.disabled=true;
  L$("voiceHint").innerHTML=`<b>这台设备没有德语语音</b> —— 朗读会用别的语言念德语。${Lesc(LvoiceAdvice())}`;return}
 sel.disabled=false;
 sel.innerHTML=list.slice().sort((a,b)=>LvoiceRank(b)-LvoiceRank(a))
  .map(v=>`<option value="${Lesc(v.voiceURI||v.name)}">${Lesc(v.name)}${LvoiceIsGood(v)?" ★":""}</option>`).join("");
 if(cur)sel.value=cur.voiceURI||cur.name;
 const q=LvoiceQuality(cur);
 L$("voiceHint").innerHTML=q==="good"?"★ 表示高音质语音。"
  :q==="basic"?`当前是基础音质的德语语音。想更自然：${Lesc(LvoiceAdvice())}`
  :`听着不自然的话可以换一个试试，或安装更好的德语语音：${Lesc(LvoiceAdvice())}`}
function Ldownload(name,obj){const b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),500)}
function LbuildShell(){document.title="Deutsch Wörter";const wrap=document.querySelector(".wrap"),title=wrap.querySelector("h1"),sub=wrap.querySelector(".sub"),app=L$("app");title.textContent="Deutsch Wörter";sub.textContent="从认识单词到真正记住。";const back=document.createElement("button");back.id="modeBack";back.className="modeBack hidden";back.textContent="← 首页";sub.after(back);const old=[...app.children];const quiz=document.createElement("section");quiz.id="quizView";quiz.className="hidden";old.forEach(x=>quiz.appendChild(x));const home=document.createElement("section");home.id="homeView";home.innerHTML=`<button class="todayCard" id="goToday" disabled><span class="todayTop">🎯 今日任务 · <b id="todayCount">0</b> 词</span><span class="todaySub" id="todayBreak">正在准备…</span></button><div class="homeSpellRow"><label class="switch"><input id="homeSpellToggle" type="checkbox"> 本轮包含拼写</label><span class="small" id="homeSpellHint"></span></div><div class="modeGrid"><button class="modeCard" id="goLearn"><span class="modeIcon">📖</span><strong>学新词</strong><p>先认识意思，再做选择，最后才进入主动回忆与拼写。</p><span class="modeTag">按级别和章节逐步推进</span></button><button class="modeCard" id="goQuiz"><span class="modeIcon">✅</span><strong>单词检测</strong><p>保留原来的全词库检测、错词优先、英德双向和拼写检查。</p></button></div><div class="panel"><b>学习进度 · 全部词库</b><div class="stats" style="margin-bottom:4px"><div class="stat"><b id="homeLearning">0</b><span>学习中</span></div><div class="stat"><b id="homeDue">0</b><span>待复习</span></div><div class="stat"><b id="homeMastered">0</b><span>已掌握</span></div><div class="stat"><b id="homeQuizWeak">0</b><span>检测错词</span></div></div><div id="homeTools" class="homeTools"></div></div>`;const learn=document.createElement("section");learn.id="learnView";learn.className="hidden";learn.innerHTML=`<div class="panel"><div class="grid"><label>学习级别<select id="learnLevel"></select></label><label>章节<select id="learnChapter"></select></label><label>每轮新词<select id="learnCount"><option>5</option><option>10</option><option>15</option><option>20</option><option>30</option><option>50</option></select></label><label>每组<select disabled><option>5</option></select></label></div><div class="row" style="margin-top:10px"><label class="switch"><input id="learnSpellToggle" type="checkbox"> 本轮包含拼写</label><span class="small" id="learnSpellNote"></span></div><div class="row" style="margin-top:10px"><label style="flex:2 1 190px">发音语音<select id="voicePick"></select></label><label style="flex:1 1 90px">语速<select id="voiceRate"><option value="0.7">慢</option><option value="0.85">正常</option><option value="1">快</option></select></label><button class="secondary" id="voiceTest">🔊 试听</button></div><div class="row" style="margin-top:8px"><label class="switch"><input id="recordedToggle" type="checkbox"> 优先使用真人发音</label><span class="small" id="recordedNote"></span></div><div class="small" id="voiceHint"></div><div class="row" style="margin-top:12px"><button class="primary" id="learnStartBtn" disabled>正在准备…</button><button class="secondary" id="learnReviewBtn" disabled>复习到期词</button><button class="learnDanger" id="learnResetBtn">重置当前章节进度</button></div><div class="coverage" id="learnCoverage"></div></div><div class="stats"><div class="stat"><b id="lNew">0</b><span>还没学</span></div><div class="stat"><b id="lLearning">0</b><span>学习中</span></div><div class="stat"><b id="lDue">0</b><span>到期复习</span></div><div class="stat"><b id="lMastered">0</b><span>已掌握</span></div></div><div class="learnCard" id="learnCard"><span class="badge" id="learnBadge">零基础学习模式</span><div class="progress"><div id="learnBar"></div></div><div id="learnBody"><div class="sessionDone"><div class="big">📖</div><h2>正在准备词库</h2><p class="sub">加载完成后可以选择级别和 Kapitel。</p></div></div><div id="learnFeedback" class="feedback"></div><div class="row learnNextRow"><button class="primary" id="learnNextBtn" style="display:none">继续</button></div></div>`;app.append(home,learn,quiz);const tools=quiz.querySelector(".tools"),status=quiz.querySelector("#appStatus");if(tools)L$("homeTools").appendChild(tools);if(status)L$("homeTools").appendChild(status);L$("goToday").onclick=()=>LstartToday();L$("goLearn").onclick=()=>Lshow("learn");L$("goQuiz").onclick=()=>Lshow("quiz");back.onclick=()=>Lshow("home");for(const id of ["learnSpellToggle","homeSpellToggle"]){const el=L$(id);if(el){el.checked=learnSpelling;el.onchange=()=>LsetSpelling(el.checked)}}LspellNote();const lc=L$("learnCount");lc.value=String(DWStore.prefs().count||10);if(!lc.value)lc.value="10";
lc.onchange=()=>{DWStore.prefs({count:+lc.value});LupdateToday()};
L$("voiceRate").value=String(DWStore.prefs().rate||0.85);L$("voiceRate").onchange=()=>{DWStore.prefs({rate:+L$("voiceRate").value});Lspeak("Guten Tag")};L$("voicePick").onchange=()=>{DWStore.prefs({voice:L$("voicePick").value});LrenderVoicePicker();Lspeak("Guten Tag")};const rec=L$("recordedToggle");rec.checked=DWStore.prefs().recorded!==false;
rec.onchange=()=>{DWStore.prefs({recorded:rec.checked});LrecordedNote()};LrecordedNote();
L$("voiceTest").onclick=()=>Lspeak("Haus");LrenderVoicePicker();L$("learnStartBtn").onclick=()=>Lstart(false);L$("learnReviewBtn").onclick=()=>Lstart(true);L$("learnNextBtn").onclick=()=>{learnPos++;Lrender();Lbring(L$("learnCard"),"start")};L$("learnLevel").onchange=()=>{DWStore.prefs({level:L$("learnLevel").value});LsyncChapters()};L$("learnChapter").onchange=()=>{DWStore.prefs({chapter:L$("learnChapter").value});Lstats();Llanding()};L$("learnResetBtn").onclick=()=>{const label=LscopeLabel();if(confirm(`确定重置 ${label} 的背词进度吗？其他章节和单词检测记录不会受影响。`)){for(const c of Lcards())delete learnProgress[c.id];DWStore.queue(LEARN_KEY,()=>learnProgress);DWStore.flush();Lstats();LhomeStats();Llanding("已重置当前章节，可以重新从第一个词开始。")}};L$("exportBtn").onclick=()=>{DWStore.flush();DWStore.exportBackup()};L$("importBtn").onclick=()=>L$("fileImport").click();L$("fileImport").onchange=async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;try{const d=JSON.parse(await f.text());let q,l,w;if(d.version>=2&&(d.quizProgress||d.learnProgress)){q=d.quizProgress||{};l=d.learnProgress||{};w=(d.spellingWrongBook&&typeof d.spellingWrongBook==="object")?d.spellingWrongBook:{}}else{const p=d.progress||d;if(!p||typeof p!=="object"||Array.isArray(p))throw 0;q=p;l={};w={}}
// Import merges instead of replacing. Restoring a 2-word backup from another
// device used to overwrite a fully-studied deck.
const mode=(Object.keys(q).length+Object.keys(l).length)&&confirm("把备份【合并】进现有记录吗？\n\n确定 = 合并（同一个词保留较新的一次）\n取消 = 用备份【完全替换】本机记录")?"merge":"replace";
if(mode==="merge"){progress=mergeProgress(progress,q,"last");learnProgress=mergeProgress(learnProgress,l,"last");wrongBook=mergeProgress(wrongBook,w,"lastAt")}else{progress=q;learnProgress=l;wrongBook=w}
DWStore.queue(STORE_KEY,()=>progress);DWStore.queue(LEARN_KEY,()=>learnProgress);DWStore.queue(WRONG_KEY,()=>wrongBook);DWStore.flush();DWStore.markBackedUp();
stats();Lstats();LhomeStats();if(typeof LupdateWrongBadge==="function")LupdateWrongBadge();if(typeof LupdateMasteredBadge==="function")LupdateMasteredBadge();
alert(mode==="merge"?"备份已合并到现有记录。":"本机记录已被备份替换。")}catch(err){alert("无法识别这个备份文件。")}e.target.value=""};Lshow("home")}
function LreadyFail(msg,retry){const b=L$("learnStartBtn");if(b){b.disabled=true;b.textContent="学习词库未就绪"}if(!LreadyFail.noticed){LreadyFail.noticed=true;DWStore.notice("bad",`<b>背词模式的数据没能加载。</b> ${Lesc(msg)}｜单词检测不受影响。`,[{label:"重新加载",run:row=>{row.remove();LreadyFail.noticed=false;retry()}}])}const body=L$("learnBody");if(body)body.innerHTML=`<div class="sessionDone"><div class="big">⚠️</div><h2>学习词库没能加载</h2><p class="sub">${Lesc(msg)}</p><div class="learnActions"><button class="primary" id="learnRetry">重新加载</button></div></div>`;const r=L$("learnRetry");if(r)r.onclick=()=>{if(body)body.innerHTML=`<div class="sessionDone"><div class="big">⏳</div><h2>正在重新加载…</h2></div>`;retry()}}
async function Lready(){
  const b=L$("learnStartBtn");if(b)b.textContent="正在准备…";
  try{
    // The deck is loaded once by the page shell; await that instead of polling for it.
    const cards=await (window.__cardsReady||Promise.reject(new Error("词库加载器未启动")));
    if(!Array.isArray(cards)||!cards.length)throw new Error("词库内容无效");
    // Chinese meanings used to arrive as a separate positional file, which is how
    // one missing line could shift every remaining meaning by one. They now ride
    // on the card itself, so they cannot drift apart. A deck without them is fine:
    // Lmeaning falls back to the English gloss.
    ZH={};for(const c of cards)if(c.zh)ZH[c.id]=c.zh;
    LrestoreScope();
    Lcoverage(cards);
    LreadyFail.noticed=false;
    if(b){b.disabled=false;b.textContent="开始学新词"}
    const rv=L$("learnReviewBtn");if(rv)rv.disabled=false;
    Lstats();LhomeStats();
    if(typeof LupdateMasteredBadge==="function")LupdateMasteredBadge();
    Lopener();
  }catch(e){
    console.error("learning data load failed",e);
    LreadyFail(String(e&&e.message||e),()=>Lready());
  }
}
// ?mastered=1 opens the mastered archive straight away. It was documented nowhere
// and read nowhere, so the link simply did nothing.
function Lopener(){let q;try{q=new URLSearchParams(location.search)}catch(e){return}
  const view=q.get("view");
  if(q.get("mastered")==="1"){Lshow("learn");if(typeof LopenMastered==="function")LopenMastered();return}
  if(q.get("wrong")==="1"){Lshow("learn");if(typeof LopenWrongBook==="function")LopenWrongBook();return}
  if(view==="learn"||view==="quiz")Lshow(view)}
function Lboot(){LbuildShell();LinitWrongBookUI();LinitMasteredUI();LinitDrillUI();Lready()}
