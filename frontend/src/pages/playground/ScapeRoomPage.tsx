// TEMPORARY — youth group escape room game (2026-10-17). Safe to delete this file
// together with the matching block in App.tsx.
import React, { useCallback, useEffect, useState } from 'react';

const ACCESS_PASSWORD = 'R12.2';
const VAULT_CODE = '1414';


const css = `
.sr-root{position:fixed;inset:0;overflow:hidden;font-family:"Courier New",monospace;color:#d8dde3;
  background:radial-gradient(ellipse at 50% 40%,#2b3138 0%,#15191d 55%,#07090b 100%);user-select:none}
.sr-root *{box-sizing:border-box}

/* ── Gate ── */
.sr-gate{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px}
.sr-gate-card{width:100%;max-width:360px;padding:32px 24px;border:1px solid #3a4148;border-radius:12px;
  background:rgba(10,12,14,.85);text-align:center;box-shadow:0 0 40px rgba(0,0,0,.6)}
.sr-gate h1{font-size:18px;letter-spacing:4px;margin:0 0 8px;color:#e9c46a}
.sr-gate p{font-size:13px;margin:0 0 20px;color:#8a949e}
.sr-gate input{width:100%;padding:12px;font:inherit;font-size:20px;text-align:center;letter-spacing:4px;
  background:#050607;border:1px solid #3a4148;border-radius:8px;color:#e9c46a;outline:none}
.sr-gate input:focus{border-color:#e9c46a}
.sr-gate button{margin-top:14px;width:100%;padding:12px;font:inherit;font-size:14px;letter-spacing:3px;
  background:#e9c46a;color:#111;border:0;border-radius:8px;cursor:pointer;font-weight:bold}
.sr-gate .sr-err{color:#e76f51;font-size:13px;height:18px;margin-top:10px}

/* ── Room ── */
.sr-room{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;perspective:1400px}
.sr-wall{position:absolute;inset:0;
  background:
    repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0 2px,transparent 2px 160px),
    repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 2px,transparent 2px 160px);}
.sr-floor{position:absolute;left:0;right:0;bottom:0;height:22%;
  background:linear-gradient(180deg,#0e1114 0%,#050607 100%);border-top:2px solid #22282e}
.sr-lamp{position:absolute;top:0;left:50%;width:70vmin;height:60vmin;transform:translateX(-50%);
  background:radial-gradient(ellipse at 50% 0%,rgba(255,220,150,.12),transparent 70%);pointer-events:none}

.sr-frame{--d:min(94vw,78vh,560px);position:relative;width:var(--d);height:var(--d);border-radius:50%;
  background:radial-gradient(circle,#0a0c0e 60%,#2a3036 61%,#4a535c 66%,#1c2125 72%);
  box-shadow:0 0 0 10px #15191d,0 0 0 14px #3a4148,0 30px 80px rgba(0,0,0,.8)}
.sr-light{position:absolute;inset:6%;border-radius:50%;background:#fff;opacity:0;
  box-shadow:0 0 0 0 #fff;transition:opacity 1.2s ease .6s,box-shadow 3s ease 1.4s}
.sr-open .sr-light{opacity:1;box-shadow:0 0 120px 60px #fff,0 0 400px 200px rgba(255,255,255,.9)}
.sr-flood{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity 2.5s ease 3.2s}
.sr-open .sr-flood{opacity:1}

.sr-door{position:absolute;inset:6%;border-radius:50%;transform-origin:0% 50%;
  transition:transform 2.6s cubic-bezier(.6,0,.3,1) 1.1s;transform-style:preserve-3d;
  background:radial-gradient(circle at 35% 30%,#8b959f 0%,#5d666f 35%,#3b4249 70%,#262b30 100%);
  box-shadow:inset 0 0 0 8px #2a3036,inset 0 0 0 12px #6b747d,inset 0 0 40px rgba(0,0,0,.7),0 10px 30px rgba(0,0,0,.6);
  display:flex;flex-direction:column;align-items:center;justify-content:center}
.sr-open .sr-door{transform:rotateY(-105deg)}
.sr-bolt{position:absolute;width:5%;height:5%;border-radius:50%;
  background:radial-gradient(circle at 35% 35%,#c9d0d6,#4a525a 70%);box-shadow:0 2px 3px rgba(0,0,0,.6)}
.sr-hinge{position:absolute;left:-3%;width:8%;height:14%;border-radius:6px;
  background:linear-gradient(90deg,#2a3036,#6b747d,#2a3036)}

.sr-wheel{position:relative;width:34%;height:34%;border-radius:50%;margin-bottom:6%;
  transition:transform 1.1s cubic-bezier(.5,0,.3,1)}
.sr-open .sr-wheel{transform:rotate(540deg)}
.sr-wheel::before{content:"";position:absolute;inset:0;border-radius:50%;border:6px solid #b8c0c7;
  box-shadow:0 0 0 2px #3b4249,inset 0 0 0 2px #3b4249}
.sr-spoke{position:absolute;left:50%;top:50%;width:100%;height:8%;margin-left:-50%;margin-top:-4%;
  background:linear-gradient(180deg,#d1d7dc,#79828b);border-radius:4px}
.sr-hub{position:absolute;left:50%;top:50%;width:26%;height:26%;transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(circle at 35% 35%,#e3e7ea,#5d666f)}

.sr-panel{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;
  background:#101316;box-shadow:inset 0 0 0 2px #2a3036,0 4px 10px rgba(0,0,0,.5)}
.sr-slots{display:flex;gap:6px}
.sr-slot{width:min(8vmin,40px);height:min(10vmin,50px);display:flex;align-items:center;justify-content:center;
  font-size:min(6vmin,30px);font-weight:bold;color:#7CFC9A;background:#030404;border-radius:6px;
  box-shadow:inset 0 0 0 1px #2f363c;text-shadow:0 0 8px rgba(124,252,154,.7)}
.sr-slot.sr-active{box-shadow:inset 0 0 0 2px #e9c46a}
.sr-wrong .sr-slot{color:#ff5a4e;text-shadow:0 0 8px rgba(255,90,78,.8)}
.sr-wrong .sr-panel{animation:sr-shake .45s}
@keyframes sr-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
.sr-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.sr-key{width:min(9vmin,40px);height:min(6.5vmin,32px);font:inherit;font-size:min(3.2vmin,16px);font-weight:bold;
  color:#d8dde3;background:linear-gradient(180deg,#4a535c,#2a3036);border:0;border-radius:5px;cursor:pointer;
  box-shadow:0 2px 0 #111}
.sr-key:active{transform:translateY(2px);box-shadow:none}
.sr-key.sr-ok{background:linear-gradient(180deg,#3f7d4f,#24503a)}
.sr-key.sr-del{background:linear-gradient(180deg,#7d4a3f,#50302a)}
.sr-hint{position:absolute;bottom:3%;width:100%;text-align:center;font-size:12px;letter-spacing:3px;color:#59626b}
`;

const BOLTS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { left: `${50 + Math.cos(a) * 44 - 2.5}%`, top: `${50 + Math.sin(a) * 44 - 2.5}%` };
});

function Gate({ onPass }: { onPass: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim().toUpperCase() === ACCESS_PASSWORD) onPass();
    else {
      setError('Contraseña incorrecta');
      setValue('');
    }
  };

  return (
    <div className="sr-gate">
      <form className="sr-gate-card" onSubmit={submit}>
        <h1>ACCESO RESTRINGIDO</h1>
        <p>Introduce la contraseña para entrar</p>
        <input autoFocus value={value} onChange={(e) => { setValue(e.target.value); setError(''); }} />
        <button type="submit">ENTRAR</button>
        <div className="sr-err">{error}</div>
      </form>
    </div>
  );
}

function Vault() {
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const [open, setOpen] = useState(false);

  const press = useCallback((k: string) => {
    if (open) return;
    setWrong(false);
    if (k === 'del') setCode((c) => c.slice(0, -1));
    else if (k === 'ok') {
      if (code === VAULT_CODE) setOpen(true);
      else {
        setWrong(true);
        setTimeout(() => { setWrong(false); setCode(''); }, 900);
      }
    } else setCode((c) => (c.length < 4 ? c + k : c));
  }, [open, code]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className={`sr-room${open ? ' sr-open' : ''}${wrong ? ' sr-wrong' : ''}`}>
      <div className="sr-wall" />
      <div className="sr-floor" />
      <div className="sr-lamp" />
      <div className="sr-frame">
        <div className="sr-light" />
        <div className="sr-door">
          {BOLTS.map((b, i) => <div key={i} className="sr-bolt" style={b} />)}
          <div className="sr-hinge" style={{ top: '22%' }} />
          <div className="sr-hinge" style={{ bottom: '22%' }} />
          <div className="sr-wheel">
            {[0, 60, 120].map((r) => <div key={r} className="sr-spoke" style={{ transform: `rotate(${r}deg)` }} />)}
            <div className="sr-hub" />
          </div>
          <div className="sr-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sr-slots">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`sr-slot${i === code.length && !open ? ' sr-active' : ''}`}>{code[i] ? '*' : ''}</div>
              ))}
            </div>
            <div className="sr-keys">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
                <button
                  key={k}
                  className={`sr-key${k === 'ok' ? ' sr-ok' : k === 'del' ? ' sr-del' : ''}`}
                  onClick={() => press(k)}
                >
                  {k === 'del' ? '←' : k === 'ok' ? '✓' : k}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {!open && <div className="sr-hint">INTRODUCE EL CÓDIGO DE 4 DÍGITOS</div>}
      <div className="sr-flood" />
    </div>
  );
}

export default function ScapeRoomPage() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    document.title = 'Scape Room';
  }, []);

  return (
    <div className="sr-root">
      <style>{css}</style>
      {allowed ? <Vault /> : <Gate onPass={() => setAllowed(true)} />}
    </div>
  );
}
