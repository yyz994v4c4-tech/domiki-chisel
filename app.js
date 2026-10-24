'use strict';
// iPad reports standalone separately from the CSS display-mode media query.
const standaloneQuery=window.matchMedia?window.matchMedia('(display-mode: standalone)'):null;
function syncAppMode(){if(document.body)document.body.classList.toggle('app-standalone',!!(window.navigator&&window.navigator.standalone)||!!(standaloneQuery&&standaloneQuery.matches))}
syncAppMode();if(standaloneQuery&&standaloneQuery.addEventListener)standaloneQuery.addEventListener('change',syncAppMode);
window.addEventListener&&window.addEventListener('pageshow',syncAppMode);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function closestDrop(el){return el&&el.closest('[data-drop]')}
function closeDialog(el){
 if(typeof el.close==='function'){el.close();return}
 el.removeAttribute('open');el.classList.remove('fallback-dialog');
 if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-fallback-open');
}
function openDialog(el){
 if(typeof el.showModal==='function'){el.showModal();return}
 el.setAttribute('open','');el.classList.add('fallback-dialog');
 el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');
 document.body.classList.add('dialog-fallback-open');
 const first=el.querySelector('button,select,input');if(first)first.focus();
}

const defaults = {number:3,rep:'objects',voice:true,voiceURI:'',music:false,effects:true,reward:'bubbles',length:'house',objectKind:'cars'};
function readStore(key,fallback){try{const value=JSON.parse(localStorage.getItem(key));return value==null?fallback:value}catch{return fallback}}
let settings={...defaults,...readStore('number-houses-settings',{})};
settings.number=Math.min(10,Math.max(1,Number(settings.number)||3));
let stats=readStore('number-houses-progress',{});
let state,voices=[],audioCtx,musicTimer,musicNodes=[],rewardTimer;
const modeDetails={houses:['⌂','Домики','Состав числа','У каждого числа свой дом','На каждом этаже два числа. Вместе — число на крыше.'],compare:['≷','Сравнение','Больше и меньше','Сравниваем по парам','Соедини шарики в пары и найди те, что остались.'],add:['+','Прибавить','Собираем вместе','Добавляем — становится больше','Передвигай предметы и смотри, как меняется количество.'],subtract:['−','Отнять','Убираем часть','Убираем — остаётся меньше','Убери часть предметов и посчитай, сколько осталось.']};
const numberWords=['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять','десять'];
const word=n=>numberWords[n]||String(n);
const objectKinds={balls:{icon:'🔴',label:'Шарики',single:'шарик'},cars:{icon:'🚗',label:'Машинки',single:'машинку'},apples:{icon:'🍎',label:'Яблоки',single:'яблоко'},leaves:{icon:'🍁',label:'Листья',single:'лист'},cats:{icon:'🐱',label:'Кошки',single:'кошку'},dogs:{icon:'🐶',label:'Собаки',single:'собаку'}};
function currentKind(){return objectKinds[settings.objectKind]||objectKinds.cars}
function objectIcon(){return `<span class="object-symbol" aria-hidden="true">${currentKind().icon}</span>`}
function objectPickerHTML(){return Object.entries(objectKinds).map(([key,o])=>`<button class="object-type ${key===settings.objectKind?'selected':''}" data-object="${key}" aria-label="${o.label}" aria-pressed="${key===settings.objectKind}"><span aria-hidden="true">${o.icon}</span></button>`).join('')}
function feedbackHTML(){return `<div class="feedback ${state.feedback?'has-feedback':''}" role="status" aria-live="polite"><span class="feedback-symbol" aria-hidden="true">${state.feedback?(state.helped?'💡':'↻'):''}</span><span class="sr-only">${state.feedback||''}</span></div>`}
function actionHTML(){return `<div class="action-row"><button class="help-btn icon-action" id="hint" aria-label="Показать подсказку"><span aria-hidden="true">💡</span></button><button class="primary check-action" id="check" aria-label="Проверить ответ"><span aria-hidden="true">✓</span></button><button class="repeat-btn icon-action" id="repeatInstruction" aria-label="Повторить задание голосом"><span aria-hidden="true">🔊</span></button></div>`}
function trayHTML(){return `<div class="tray"><span class="move-arrow" aria-hidden="true">←</span><button class="tray-ball" data-ball="true" aria-label="Добавить один предмет. Нажать или перетащить">${objectIcon()}<span class="add-one" aria-hidden="true">+1</span></button><span class="tap-hand" aria-hidden="true">👆</span></div>`}

function save(){try{localStorage.setItem('number-houses-settings',JSON.stringify(settings));localStorage.setItem('number-houses-progress',JSON.stringify(stats))}catch{}}
function shuffle(a){return a.map(v=>({v,r:Math.random()})).sort((a,b)=>a.r-b.r).map(x=>x.v)}
function choices(expected,max=state.n){const vals=new Set([expected]);for(const x of shuffle(Array.from({length:max+1},(_,i)=>i))) {if(vals.size>=4)break;vals.add(x)}return shuffle([...vals])}
function newSession(mode=(state&&state.mode)||'houses',n=settings.number){
 speechSynthesisSafeCancel(); clearTimeout(rewardTimer); closeDialog($('#rewardDialog')); closeDialog($('#finishDialog'));
 settings.number=n;save();state={mode,n,step:0,solved:0,helped:false,errors:0,placed:0,selected:null,done:false,compareStage:0,links:false,removed:[],sessionIndependent:0,sessionHelped:0};initTask();render();window.scrollTo(0,0);
}
function initTask(){
 state.helped=false;state.errors=0;state.placed=0;state.emptyChosen=false;state.selected=null;state.compareStage=0;state.links=false;state.removed=[];state.feedback='';
 if(state.mode==='houses'){state.a=state.step<state.n?state.step+1:0;state.b=state.n-state.a;state.expected=state.b;state.opts=choices(state.b)}
 else if(state.mode==='compare'){
 const arrangements=[[state.n,Math.max(0,state.n-2)],[Math.max(0,state.n-1),state.n],[state.n,state.n]];
 [state.top,state.bottom]=arrangements[state.step%3];state.expected=Math.abs(state.top-state.bottom);state.opts=choices(state.expected);
 }else {state.a=1+(state.step%state.n);state.b=state.n-state.a;state.expected=state.mode==='add'?state.n:state.a;state.opts=choices(state.expected)}
}
function taskLimit(){let max=state.mode==='houses'?state.n+1:3;return settings.length==='house'?max:Math.min(max,Number(settings.length))}
function render(){
 $('#modeNav').innerHTML=Object.entries(modeDetails).map(([key,v])=>`<button class="nav-item ${key===state.mode?'active':''}" data-mode="${key}" aria-label="${v[1]}" aria-current="${key===state.mode?'page':'false'}"><span class="nav-icon" aria-hidden="true">${v[0]}</span><span class="nav-name">${v[1]}</span></button>`).join('');
 $('#pageTitle').textContent=modeDetails[state.mode][3];$('#pageSubtitle').textContent=modeDetails[state.mode][4];
 $('#numbers').innerHTML=Array.from({length:10},(_,i)=>`<button class="number-btn ${i+1===state.n?'selected':''}" data-number="${i+1}" aria-label="Число ${i+1}" aria-pressed="${i+1===state.n}">${i+1}</button>`).join('');
 $('#objectPicker').innerHTML=objectPickerHTML();
 $$('.representation button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.rep===settings.rep));
 $('#activityLabel').innerHTML=`<span aria-hidden="true">${modeDetails[state.mode][0]}</span><span class="sr-only">${state.mode==='houses'?'Домик числа '+state.n:modeDetails[state.mode][1]}</span>`;
 if(state.done){$('#gameArea').innerHTML='<div class="rest-view"><div class="finished-symbol" aria-hidden="true">👋</div><h2 class="sr-only">Занятие завершено. Можно отдохнуть.</h2><button class="icon-action restart-btn" id="startAgain" aria-label="Начать новое занятие"><span aria-hidden="true">↻</span></button></div>';$('#endSession').hidden=true;$('#progress').innerHTML='<span aria-hidden="true">✓</span><span class="sr-only">Занятие завершено</span>';return}
 $('#endSession').hidden=false;
 $('#gameArea').innerHTML=state.mode==='houses'?houseHTML():state.mode==='compare'?compareHTML():operationHTML();
 $('#progress').innerHTML=`<span class="progress-dots" aria-hidden="true">${Array.from({length:taskLimit()},(_,i)=>`<i class="${i<state.solved?'done':i===state.step?'current':''}"></i>`).join('')}</span><span class="sr-only">Задание ${state.step+1} из ${taskLimit()}</span><span class="progress-count" aria-hidden="true">${state.step+1}/${taskLimit()}</span>`;
}
function dotHTML(n,interactive=false,known=false){return `<div class="objects-grid" aria-label="${n} предметов">${Array.from({length:n},(_,i)=>`<button class="count-object ${interactive?'removable':'known-object'}" ${interactive?`data-remove="${i}"`:`data-knowncount="${i+1}"`} aria-label="${interactive?'Убрать предмет':'Посчитать предмет'} ${i+1}">${objectIcon()}${interactive?'<span class="remove-mark" aria-hidden="true">−</span>':''}</button>`).join('')}</div>`}
function houseHTML(){
 let summary='';for(let i=0;i<=state.n;i++){const a=i<state.n?i+1:0;summary+=`<div class="mini-floor ${i<state.solved?'done':i===state.step?'current':'pending'}" aria-label="${i<state.solved?a+' и '+(state.n-a):'Этаж '+(i+1)}"><span>${a}</span><i></i><span>${i<state.solved?state.n-a:'·'}</span></div>`}
 const digitMode=settings.rep==='digits';
 const left=`<span class="room-number">${state.a}</span>${!digitMode?dotHTML(state.a,false,true):''}`;
 const amount=digitMode?state.selected:(state.placed|| (state.emptyChosen?0:null));
 const right=`<span class="room-number ${amount===null?'placeholder':''}">${(amount==null?'?':amount)}</span>${!digitMode?dotHTML(state.placed,true):''}`;
 return `<div class="house-game ${digitMode?'digits':'objects'}"><div class="house-scene palette-${state.n%3}"><div class="roof"><svg viewBox="0 0 360 110" preserveAspectRatio="none" aria-hidden="true"><path d="M284 52V17h30v62" fill="#ead0ac" stroke="#bf9c70" stroke-width="3"/><path d="M13 106 180 9 347 106" fill="#8cafbe" stroke="#5c8196" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/><path d="m31 102 149-85 149 85" fill="none" stroke="#c7dce3" stroke-width="2"/></svg><div class="roof-number" aria-label="Всего ${state.n}">${state.n}</div></div><div class="house-body"><div class="floor active"><div class="window">${left}</div><div class="window target ${state.feedback&&!state.helped?'needs-retry':''}" data-drop="house" tabindex="0" role="button" aria-label="Правая комната. Добавить один предмет">${right}</div></div><div class="house-base"></div></div><div class="floor-summary" aria-label="Этажи домика">${summary}</div></div><div class="instruction"><h2 class="sr-only">Добавь недостающие предметы в правую комнату</h2><div class="task-math" aria-label="${state.a} плюс сколько равно ${state.n}"><span>${state.a}</span><span class="math-sign">+</span><span class="math-unknown">${digitMode?((state.selected==null?'?':state.selected)):'?'}</span><span class="math-sign">=</span><strong>${state.n}</strong></div>${digitMode?choiceHTML():trayHTML()}${!digitMode&&state.placed===0?'<button class="zero-btn" id="chooseZero" aria-label="Ноль. Оставить правую комнату пустой"><span aria-hidden="true">0</span></button>':''}${actionHTML()}${feedbackHTML()}</div></div>`;
}
function choiceHTML(){return `<div class="choices" aria-label="Выбрать ответ">${state.opts.map(x=>`<button class="choice ${state.selected===x?'chosen':''}" data-value="${x}" aria-label="Ответ ${x}" aria-pressed="${state.selected===x}">${x}</button>`).join('')}</div>`}
function compareHTML(){
 const lo=Math.min(state.top,state.bottom),slots=Math.max(state.top,state.bottom,1),digitMode=settings.rep==='digits';
 function row(n,side){return `<div class="compare-row ${side}" style="--slots:${slots}"><span class="count-label">${n}</span>${Array.from({length:slots},(_,i)=>i<n?`<button class="compare-ball ${state.links&&i>=lo?'extra':''}" data-count="${i+1}" aria-label="${side==='upper'?'Верхний':'Нижний'} предмет ${i+1}${state.links&&i>=lo?', без пары':''}">${objectIcon()}</button>`:'<span class="empty-pair" aria-hidden="true"></span>').join('')}</div>`}
 const content=state.compareStage===0?`<div class="answer-row"><button data-compare="top" aria-label="${digitMode?'Первое число больше':'Сверху больше'}"><span aria-hidden="true">${digitMode?'←':'↑'}</span></button><button data-compare="equal" aria-label="Поровну"><span aria-hidden="true">=</span></button><button data-compare="bottom" aria-label="${digitMode?'Второе число больше':'Снизу больше'}"><span aria-hidden="true">${digitMode?'→':'↓'}</span></button></div>`:`<div class="difference-math" aria-label="На сколько больше">${Math.max(state.top,state.bottom)} − ${Math.min(state.top,state.bottom)} = ?</div>${choiceHTML()}${actionHTML()}`;
 return `<div class="compare-game"><h2 class="sr-only">${state.compareStage?'На сколько больше?':'Где больше?'}</h2>${digitMode?`<div class="numeric-compare"><span>${state.top}</span><span class="relation">?</span><span>${state.bottom}</span></div>`:`<div class="compare-scroll"><div class="compare-board">${row(state.top,'upper')}<div class="compare-links ${state.links?'shown':''}" style="--slots:${slots}"><span></span>${Array.from({length:slots},(_,i)=>i<lo?'<i></i>':'<span></span>').join('')}</div>${row(state.bottom,'lower')}</div></div><button id="showPairs" class="pair-action" aria-label="Соединить предметы в пары"><span aria-hidden="true">${state.links?'✓':'↕'}</span></button>`}${content}${state.compareStage===0?'<div class="compare-help"><button class="icon-action" id="hint" aria-label="Показать подсказку">💡</button><button class="icon-action" id="repeatInstruction" aria-label="Повторить задание голосом">🔊</button></div>':''}${feedbackHTML()}</div>`;
}
function operationCount(){return state.mode==='add'?state.a+state.placed:state.n-state.removed.length}
function operationHTML(){
 const adding=state.mode==='add',count=operationCount(),digitMode=settings.rep==='digits';
 const total=adding?count:state.n;
 const objects=!digitMode?`<div><div class="object-basin" data-drop="operation" aria-label="${count} предметов">${Array.from({length:total},(_,i)=>`<button class="big-ball ${adding&&i>=state.a?'added':''} ${state.removed.includes(i)?'removed':''}" data-opball="${i}" aria-label="${adding?'Посчитать или убрать добавленный предмет':'Убрать или вернуть предмет'} ${i+1}">${objectIcon()}${!adding?'<span class="remove-mark" aria-hidden="true">−</span>':''}</button>`).join('')}</div>${adding?trayHTML():'<div class="tap-to-remove" aria-hidden="true">👆　−</div>'}</div>`:'';
 return `<div class="operation-game"><h2 class="sr-only">${adding?'Добавь предметы':'Убери предметы'}</h2><div class="task-math operation-math"><span>${adding?state.a:state.n}</span><span class="math-sign">${adding?'+':'−'}</span><span>${state.b}</span><span class="math-sign">=</span><strong>${(state.selected==null?'?':state.selected)}</strong></div><div class="operation-grid">${objects}<div>${choiceHTML()}${actionHTML()}</div></div>${feedbackHTML()}</div>`;
}
function instructionText(){if(state.mode==='houses')return `Это домик числа ${word(state.n)}. Слева ${word(state.a)}. Сколько нужно справа, чтобы вместе было ${word(state.n)}?`;if(state.mode==='compare')return state.compareStage?'На сколько больше? Посчитай шарики без пары.':`Сверху ${word(state.top)}, снизу ${word(state.bottom)}. Где больше?`;return state.mode==='add'?`Было ${word(state.a)}. Добавь ещё ${word(state.b)}. Сколько получится?`:`Было ${word(state.n)}. Убери ${word(state.b)}. Сколько останется?`}
function feedback(text){state.feedback=text;const el=$('.feedback');if(el)el.innerHTML=`<span class="feedback-symbol" aria-hidden="true">↻</span><span class="sr-only">${text}</span>`;if($('.target'))$('.target').classList.add('needs-retry');speak(text)}
function addBall(){if(state.done||settings.rep!=='objects')return;state.selected=null;if(state.mode==='houses'){if(state.placed<10)state.placed++;else return}else if(state.mode==='add'){if(state.a+state.placed<10)state.placed++;else return}else return;render();speak(word(state.placed));}
function choose(n){state.selected=n;state.feedback='';render();speak(word(n))}
function check(){
 if(state.done)return;
 if(state.mode==='houses'){
 const answer=settings.rep==='objects'?state.placed:state.selected;
 if(settings.rep==='objects'&&state.placed===0&&!state.emptyChosen)return feedback('Если справа не нужны шарики, нажми «Оставить пусто». Это ноль.');
 if(answer===null)return feedback('Выбери карточку с числом.');
 if(answer===state.expected){success(`${state.a} и ${state.b} — вместе ${state.n}`,`${word(state.a)} и ${word(state.b)}. Вместе ${word(state.n)}.`)}
 else {state.errors++;feedback('Давай пересчитаем. В двух комнатах вместе должно быть '+state.n+'. Можно нажать «Помоги мне».')}
 }else if(state.mode==='compare'){
 if(state.selected===null)return feedback('Выбери, сколько шариков осталось без пары.');
 if(state.selected===state.expected)success(`${Math.max(state.top,state.bottom)} больше ${Math.min(state.top,state.bottom)} на ${state.expected}`,`Без пары ${word(state.expected)}. ${word(Math.max(state.top,state.bottom))} больше ${word(Math.min(state.top,state.bottom))} на ${word(state.expected)}.`);
 else {state.errors++;feedback('Посчитай только шарики, которые остались без пары.')}
 }else {
 if(settings.rep==='objects'){
 const moved=state.mode==='add'?state.placed:state.removed.length;
 if(moved!==state.b){state.errors++;return feedback(`${state.mode==='add'?'Добавь':'Убери'} ${state.b}. Сейчас ${state.mode==='add'?'добавлено':'убрано'} ${moved}.`)}
 }
 if(state.selected===null)return feedback('Теперь выбери ответ: сколько предметов получилось?');
 if(state.selected===state.expected){const adding=state.mode==='add';success(`${adding?state.a:state.n} ${adding?'+':'−'} ${state.b} = ${state.expected}`,`${adding?'Получилось':'Осталось'} ${word(state.expected)}.`)}else{state.errors++;feedback('Попробуем пересчитать оставшиеся предметы. Можно включить подсказку.')}
 }
}
function compareAnswer(answer){
 const right=state.top===state.bottom?'equal':state.top>state.bottom?'top':'bottom';
 if(answer!==right){state.errors++;state.links=true;render();feedback('Соединим шарики в пары. Посмотри, где остались шарики без пары.');return}
 state.links=true;
 if(right==='equal')success(`${state.top} и ${state.bottom} — поровну`,`У всех шариков есть пара. ${word(state.top)} и ${word(state.bottom)}. Поровну.`);
 else{state.compareStage=1;render();speak(instructionText())}
}
function hint(){
 state.helped=true;
 if(state.mode==='houses'){
 if(settings.rep==='objects'){state.placed=state.b;state.emptyChosen=state.b===0}else state.selected=state.b;
 state.feedback=`${state.a} и ${state.b} — вместе ${state.n}. ${state.b===0?'Пустая комната означает ноль.':'Посчитай предметы и нажми «Проверить».'}`;
 render();if($('.target'))$('.target').classList.add('hint-highlight');speak(`${word(state.a)} и ${word(state.b)}. Вместе ${word(state.n)}. ${state.b===0?'Ноль — это пустая комната.':'Посчитай и проверь.'}`);
 }else if(state.mode==='compare'){
 settings.rep='objects';save();state.links=true;state.feedback=state.top===state.bottom?'У всех шариков есть пара. Значит, поровну.':`Посмотри ${state.top>state.bottom?'наверх':'вниз'}. Без пары осталось ${state.expected}.`;if(state.compareStage)state.selected=state.expected;render();speak(state.feedback);
 }else {
 if(state.mode==='add')state.placed=state.b;else state.removed=Array.from({length:state.b},(_,i)=>state.n-1-i);
 state.selected=state.expected;state.feedback=`${state.mode==='add'?'Добавили':'Убрали'} ${state.b}. ${state.mode==='add'?'Получилось':'Осталось'} ${state.expected}. Посчитай и проверь.`;render();speak(state.feedback);
 }
}
function success(title,spoken){
 const key=state.mode==='houses'?`houses:${state.n}:${state.a}:${state.b}`:`${state.mode}:${state.n}`;
 let record=stats[key]||{independent:0,helped:0,errors:0};const independent=!state.helped&&state.errors===0;
 record[independent?'independent':'helped']++;record.errors+=state.errors;stats[key]=record;
 state[independent?'sessionIndependent':'sessionHelped']++;state.solved++;save();
 $('#rewardTitle').textContent=state.mode==='houses'?`${state.a} + ${state.b} = ${state.n}`:state.mode==='compare'?`${state.top} ${state.top===state.bottom?'=':state.top>state.bottom?'>':'<'} ${state.bottom}`:state.mode==='add'?`${state.a} + ${state.b} = ${state.n}`:`${state.n} − ${state.b} = ${state.expected}`;$('#rewardText').textContent=settings.reward==='none'?'Хорошо получилось.':settings.reward==='fireworks'?'Маленький праздник в твою честь.':'Можно полопать — и продолжим.';
 $('#rewardNext').textContent=state.solved>=taskLimit()?'⌂':'→';$('#rewardNext').setAttribute('aria-label',state.solved>=taskLimit()?'Завершить занятие':'Следующее задание');
 renderReward();openDialog($('#rewardDialog'));speak(spoken);
}
function renderReward(){
 const play=$('#rewardPlay');play.innerHTML='';clearTimeout(rewardTimer);
 if(settings.reward==='none'){play.style.height='25px';return}play.style.height='185px';
 if(settings.reward==='fireworks'){
 for(let group=0;group<3;group++)for(let i=0;i<12;i++){const spark=document.createElement('i');spark.className='firework';const a=i*Math.PI/6;spark.style.cssText=`left:${25+group*25}%;top:${40+(group%2)*15}%;--x:${Math.cos(a)*58}px;--y:${Math.sin(a)*58}px;animation-delay:${group*.45}s;background:${['#a0b398','#c7a57c','#8fa7ad'][group]}`;play.append(spark)}
 }else{
 const locations=[[9,25],[39,10],[68,30],[21,100],[52,95],[77,107]];
 locations.forEach(([x,y],i)=>{const b=document.createElement('button');b.className='bubble'+(settings.reward==='balloons'?' balloon':'');b.style.cssText=`left:${x}%;top:${y}px;animation-delay:${-i*.4}s`;b.setAttribute('aria-label',`Лопнуть ${settings.reward==='balloons'?'шарик':'пузырь'} ${i+1}`);b.onclick=()=>{if(b.disabled)return;b.disabled=true;b.classList.add('popped');softSound();};play.append(b)});
 }
 // The reward never creates new objects or extends itself.
 rewardTimer=setTimeout(()=>{play.querySelectorAll('.bubble').forEach(b=>{b.disabled=true;b.classList.add('popped')});const text=$('#rewardText');if($('#rewardDialog').open)text.textContent='Награда закончилась. Можно продолжать.';},8000);
}
function nextTask(){clearTimeout(rewardTimer);closeDialog($('#rewardDialog'));if(state.solved>=taskLimit())return finish();state.step++;initTask();render();speak(instructionText())}
function finish(){clearTimeout(rewardTimer);closeDialog($('#rewardDialog'));state.done=true;render();$('#finishText').textContent=`Выполнено заданий: ${state.solved}. ${state.solved?'Спасибо за старание!':'Продолжим в другой раз.'}`;openDialog($('#finishDialog'));speak('На сегодня готово. Теперь можно отдохнуть.');stopMusic()}
function speechSynthesisSafeCancel(){try{if(window.speechSynthesis)window.speechSynthesis.cancel()}catch(e){}}
function loadVoices(){try{if(!window.speechSynthesis||typeof window.speechSynthesis.getVoices!=='function')return;voices=window.speechSynthesis.getVoices().filter(v=>/^ru/i.test(v.lang));if($('#adultDialog').open)voiceOptions()}catch(e){voices=[]}}
function speak(text,force=false){try{speakAvailable(text,force)}catch(e){}}
function speakAvailable(text,force=false){if((!settings.voice&&!force)||!('speechSynthesis' in window))return;speechSynthesis.cancel();stopMusic();const u=new SpeechSynthesisUtterance(text);u.lang='ru-RU';u.rate=.82;u.pitch=1;u.volume=.72;const chosen=voices.find(v=>v.voiceURI===settings.voiceURI)||voices.find(v=>/milena|милена|katya|катя|irina|ирина/i.test(v.name))||voices[0];if(chosen)u.voice=chosen;u.onend=()=>{if(settings.music)startMusic()};u.onerror=()=>{if(settings.music)startMusic()};speechSynthesis.speak(u)}
function ensureAudio(){if(!audioCtx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;audioCtx=new AC()}if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});return audioCtx}
function softSound(){if(!settings.effects)return;const c=ensureAudio();if(!c)return;const osc=c.createOscillator(),g=c.createGain();osc.type='sine';osc.frequency.setValueAtTime(240,c.currentTime);osc.frequency.exponentialRampToValueAtTime(140,c.currentTime+.12);g.gain.setValueAtTime(.025,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.15);osc.connect(g).connect(c.destination);osc.start();osc.stop(c.currentTime+.16)}
function musicNote(){if(!settings.music||state.done||document.hidden)return;const c=ensureAudio();if(!c)return;const tones=[174.61,196,220,261.63];const note=tones[Math.floor(Math.random()*tones.length)];const osc=c.createOscillator(),g=c.createGain();osc.type='sine';osc.frequency.value=note;g.gain.setValueAtTime(0,c.currentTime);g.gain.linearRampToValueAtTime(.009,c.currentTime+.7);g.gain.linearRampToValueAtTime(0,c.currentTime+2.7);osc.connect(g).connect(c.destination);osc.start();osc.stop(c.currentTime+3);musicNodes.push(osc);osc.onended=()=>{musicNodes=musicNodes.filter(x=>x!==osc)}}
function startMusic(){stopMusic();if(!settings.music||state.done)return;musicNote();musicTimer=setInterval(musicNote,3300)}
function stopMusic(){clearInterval(musicTimer);musicNodes.forEach(n=>{try{n.stop()}catch{}});musicNodes=[]}
function voiceOptions(){const el=$('#setVoice');el.innerHTML='';if(!voices.length){const opt=new Option('Русский голос устройства (если доступен)','');el.add(opt)}else{el.add(new Option('Автоматически: русский голос',''));voices.forEach(v=>el.add(new Option(v.name,v.voiceURI)))}el.value=settings.voiceURI}
function openAdult(){
 updateOfflineStatus();
 $('#setNumber').innerHTML=Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');$('#setNumber').value=state.n;$('#setLength').value=settings.length;$('#setReward').value=settings.reward;$('#setSpeech').checked=settings.voice;$('#setMusic').checked=settings.music;$('#setEffects').checked=settings.effects;voiceOptions();
 const rows=Object.entries(stats);$('#stats').innerHTML=rows.length?rows.map(([key,r])=>{let [mode,n,a,b]=key.split(':');const label=mode==='houses'?`Домик ${n} · ${a} и ${b}`:`${(modeDetails[mode]&&modeDetails[mode][1])||mode} · до ${n}`;return `<div class="stat-pair"><strong>${label}</strong><br>Самостоятельно: ${r.independent} · С помощью или после ошибки: ${r.helped}</div>`}).join(''):'<p class="muted">Здесь появятся результаты первых заданий.</p>';openDialog($('#adultDialog'));
}
function updateVoiceToggle(){$('#voiceToggle').innerHTML=`<span aria-hidden="true">${settings.voice?'🔊':'🔇'}</span>`;$('#voiceToggle').setAttribute('aria-label',settings.voice?'Выключить голос':'Включить голос')}
$('#modeNav').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b){newSession(b.dataset.mode);speak(instructionText());startMusic()}});
$('#objectPicker').addEventListener('click',e=>{const b=e.target.closest('[data-object]');if(b){settings.objectKind=b.dataset.object;save();render()}});
$('#numbers').addEventListener('click',e=>{const b=e.target.closest('[data-number]');if(b){newSession(state.mode,+b.dataset.number);speak(instructionText());startMusic()}});
$$('.representation button').forEach(b=>b.onclick=()=>{settings.rep=b.dataset.rep;state.selected=null;save();render();speak(instructionText())});
$('#voiceToggle').onclick=()=>{settings.voice=!settings.voice;save();updateVoiceToggle();settings.voice?speak(instructionText()):speechSynthesisSafeCancel()};
$('#adultOpen').onclick=openAdult;$('#howOpen').onclick=()=>openDialog($('#helpDialog'));
$$('[data-close]').forEach(b=>b.onclick=()=>closeDialog($('#'+b.dataset.close)));
$('#testVoice').onclick=()=>{const saved=settings.voiceURI;settings.voiceURI=$('#setVoice').value;speak('Давай заселим домик. Один и два. Вместе три.',true);settings.voiceURI=saved};
$('#saveSettings').onclick=()=>{
 const n=+$('#setNumber').value,len=$('#setLength').value;const restart=n!==state.n||len!==settings.length;
 settings={...settings,number:n,length:len,reward:$('#setReward').value,voiceURI:$('#setVoice').value,voice:$('#setSpeech').checked,music:$('#setMusic').checked,effects:$('#setEffects').checked};save();updateVoiceToggle();closeDialog($('#adultDialog'));if(restart)newSession(state.mode,n);if(!settings.voice)speechSynthesisSafeCancel();startMusic();
};
$('#clearStats').onclick=()=>{stats={};save();$('#stats').innerHTML='<p class="muted">Результаты очищены.</p>'};
$('#rewardNext').onclick=nextTask;$('#endSession').onclick=finish;$('#finishClose').onclick=()=>{closeDialog($('#finishDialog'));speechSynthesisSafeCancel()};
$('#rewardDialog').addEventListener('cancel',e=>{e.preventDefault();nextTask()});
$('#gameArea').addEventListener('click',e=>{
 if(suppressClick){e.preventDefault();return}
 const t=e.target;
 if(t.closest('#check'))check();else if(t.closest('#hint'))hint();else if(t.closest('#startAgain')){newSession();speak(instructionText());startMusic()}
 else if(t.closest('#repeatInstruction'))speak(instructionText(),true);else if(t.closest('#chooseZero')){state.emptyChosen=true;render();speak('Ноль. Пустая комната.')}else if(t.closest('[data-ball]'))addBall();else if(t.closest('[data-remove]')){state.placed=Math.max(0,state.placed-1);render()}
 else if(t.closest('[data-value]'))choose(+t.closest('[data-value]').dataset.value);
 else if(t.closest('[data-compare]'))compareAnswer(t.closest('[data-compare]').dataset.compare);
 else if(t.closest('#showPairs')){state.links=true;render();speak(`У ${word(Math.min(state.top,state.bottom))} шариков есть пары. Без пары ${word(state.expected)}.`)}
 else if(t.closest('[data-knowncount]'))speak(word(+t.closest('[data-knowncount]').dataset.knowncount));
 else if(t.closest('[data-count]'))speak(word(+t.closest('[data-count]').dataset.count));
 else if(t.closest('[data-opball]')){const i=+t.closest('[data-opball]').dataset.opball;if(state.mode==='subtract'){if(state.removed.includes(i))state.removed=state.removed.filter(x=>x!==i);else state.removed.push(i);render();speak(`Убрано ${word(state.removed.length)}`)}else if(i>=state.a){state.placed--;render()}else speak(word(i+1))}
 else if(t.closest('[data-drop="house"]')&&settings.rep==='objects')addBall();
});
$('#gameArea').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-drop="house"]')){e.preventDefault();addBall()}});
// Pointer gestures work with a finger on iPad. Every drag also has a tap alternative.
let drag=null,suppressClick=false;
$('#gameArea').addEventListener('pointerdown',e=>{const source=e.target.closest('[data-ball],[data-value]');if(!source||e.button!==0)return;drag={x:e.clientX,y:e.clientY,id:e.pointerId,source,value:source.dataset.value,ball:source.hasAttribute('data-ball'),active:false};source.setPointerCapture(e.pointerId)});
$('#gameArea').addEventListener('pointermove',e=>{
 if(!drag||drag.id!==e.pointerId)return;if(!drag.active&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8)drag.active=true;if(!drag.active)return;e.preventDefault();
 const ghost=$('#dragGhost');ghost.style.display='flex';ghost.className=drag.ball?'ball':'';ghost.textContent=drag.ball?currentKind().icon:drag.value;ghost.style.transform=`translate(${e.clientX-24}px,${e.clientY-28}px)`;
 const under=document.elementFromPoint(e.clientX,e.clientY);$$('[data-drop]').forEach(x=>x.classList.toggle('drag-over',!!under&&x.contains(under)));
});
function endDrag(e,cancel=false){if(!drag||e.pointerId!==drag.id)return;const d=drag;drag=null;$('#dragGhost').style.display='none';$$('[data-drop]').forEach(x=>x.classList.remove('drag-over'));if(d.active){suppressClick=true;setTimeout(()=>suppressClick=false,100);if(cancel)return;const target=closestDrop(document.elementFromPoint(e.clientX,e.clientY));if(target){if(d.ball)addBall();else choose(+d.value)}}}
$('#gameArea').addEventListener('pointerup',e=>endDrag(e));$('#gameArea').addEventListener('pointercancel',e=>endDrag(e,true));
let firstGesture=true;document.addEventListener('pointerup',()=>{if(firstGesture){firstGesture=false;startMusic()}},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopMusic();speechSynthesisSafeCancel()}else if(settings.music)startMusic()});
// Render the lesson before optional device audio setup. Older Safari exposes
// speechSynthesis without EventTarget methods; audio must never block the game.
updateVoiceToggle();newSession('houses',settings.number);
loadVoices();
try{if(window.speechSynthesis){if(typeof window.speechSynthesis.addEventListener==='function')window.speechSynthesis.addEventListener('voiceschanged',loadVoices);else window.speechSynthesis.onvoiceschanged=loadVoices}}catch(e){}

// Offline preparation is optional and never blocks the lesson.
function bounded(promise,ms){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('offline-timeout')),ms);promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})})}
function verifyOffline(){
 const sw=window.navigator&&window.navigator.serviceWorker;
 if(!sw||!sw.controller||typeof MessageChannel==='undefined')return Promise.resolve(false);
 return new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve(false)},4000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(!!(e.data&&e.data.ready&&e.data.version>=7))};sw.controller.postMessage({type:'VERIFY_OFFLINE'},[channel.port2])});
}
function updateOfflineStatus(){
 return verifyOffline().then(ready=>{const el=$('#offlineStatus');el.textContent=ready?'✓ Игра сохранена. Можно отключить Wi-Fi и VPN.':'Для игры без интернета нажмите «Сохранить». После установки откройте игру с экрана «Домой» с интернетом и проверьте сохранение ещё раз.';el.dataset.ready=String(ready);return ready}).catch(()=>false);
}
async function prepareOffline(){
 const button=$('#saveOffline'),status=$('#offlineStatus');button.disabled=true;button.textContent='Сохраняю…';status.textContent='Сохраняем задания на устройстве…';
 try{
  const sw=window.navigator&&window.navigator.serviceWorker;
  if(!sw||!window.isSecureContext)throw new Error('offline-unavailable');
  if(!(await verifyOffline())){
   await bounded(sw.register('./sw.js',{updateViaCache:'none'}),12000);
   await bounded(sw.ready,12000);
   const deadline=Date.now()+12000;
   while(!(await verifyOffline())){if(Date.now()>deadline)throw new Error('offline-timeout');await new Promise(resolve=>setTimeout(resolve,250))}
  }
  if(!(await updateOfflineStatus()))throw new Error('offline-not-ready');
 }catch(e){status.textContent='Пока не удалось сохранить игру. Оставьте интернет включённым и попробуйте ещё раз. Если сообщение повторится, сообщите об этом.';status.dataset.ready='false'}
 finally{button.disabled=false;button.textContent='Сохранить для игры без интернета'}
}
$('#saveOffline').onclick=prepareOffline;
if(window.navigator&&window.navigator.serviceWorker&&window.location&&window.location.protocol!=='file:'){
 window.navigator.serviceWorker.addEventListener('controllerchange',updateOfflineStatus);
 // Do not register, download or update a worker while opening the lesson.
 // Offline setup starts only from the adult's Save button.
}
