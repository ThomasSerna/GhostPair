export const questionnaireHtml = `<!doctype html><meta charset="utf-8"><title>Questionnaire fixture</title>
<style>body{font:16px sans-serif;margin:20px}button,label,input,select{margin:8px}button span{display:inline-block;padding:12px}fieldset{padding:5px}</style>
<form id="quiz">
  <label id="choice-label"><input id="choice" type="checkbox" required>Accept answer</label>
  <label><input id="r1" type="radio" name="answer" value="one" checked>One</label>
  <input id="r-disabled" type="radio" name="answer" disabled>
  <label><input id="r2" type="radio" name="answer" value="two">Two</label>
  <select id="list"><option>A</option><option disabled>B</option><optgroup disabled label="Unavailable"><option>C</option></optgroup><option>D</option></select>
  <input id="text" name="text"><button id="next" name="step" value="next"><span id="left">Next</span><span id="right">step</span></button>
  <button id="second" name="step" value="second">Other submitter</button>
</form>
<fieldset disabled><legend><button id="legend" type="button">Enabled legend</button></legend><button id="disabled" type="button"><span id="disabled-child">Disabled</span></button></fieldset>
<button id="trusted" type="button">Requires trusted click</button>
<form id="flow"><fieldset id="step-one"><label><input id="flow-answer" type="radio" name="flow-answer" required>Answer</label><button>Continue</button></fieldset><fieldset id="step-two" hidden disabled><label><input id="flow-confirm" type="checkbox" required>Confirm</label><button>Finish</button></fieldset><output id="flow-status">Step 1</output></form>
<script>
globalThis.quizProbe={clicks:0,submits:[],legend:0,disabled:0,trusted:0,changes:[],events:[]};
document.querySelector('#quiz').addEventListener('submit',e=>{e.preventDefault();quizProbe.submits.push(e.submitter?.id??null)});
document.querySelector('#next').addEventListener('click',()=>quizProbe.clicks++);
document.querySelector('#legend').addEventListener('click',()=>quizProbe.legend++);
document.querySelector('#disabled').addEventListener('click',()=>quizProbe.disabled++);
document.querySelector('#trusted').addEventListener('click',e=>{if(e.isTrusted)quizProbe.trusted++});
document.querySelector('#flow').addEventListener('submit',e=>{e.preventDefault();const first=document.querySelector('#step-one'),second=document.querySelector('#step-two');if(!first.hidden){first.hidden=true;first.disabled=true;second.hidden=false;second.disabled=false;document.querySelector('#flow-status').textContent='Step 2'}else document.querySelector('#flow-status').textContent='Complete'});
for(const type of ['input','change'])document.addEventListener(type,e=>quizProbe.changes.push([type,e.target.id]));
for(const type of ['pointerdown','mousedown','pointerup','mouseup','pointercancel','click'])document.addEventListener(type,e=>quizProbe.events.push([type,e.target.id]));
</script>`;

export const questionnaireState = () => ({
  choice: document.querySelector('#choice').checked,
  radio: document.querySelector('input[name="answer"]:checked')?.id,
  list: document.querySelector('#list').value,
  clicks: quizProbe.clicks, submits: quizProbe.submits, legend: quizProbe.legend, disabled: quizProbe.disabled,
  trusted: quizProbe.trusted, changes: quizProbe.changes,
});
