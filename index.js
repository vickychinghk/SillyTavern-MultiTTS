import { eventSource, event_types } from '../../../../script.js';
import { getCharacters, initVoiceMap, registerTtsProvider, saveTtsProviderSettings } from '../../tts/index.js';

const NAME = 'MultiTTS';
const VERSION = '1.2.2';
const DEFAULT_ID = '__multitts_default__';
const CORE_DEFAULT = '[Default Voice]';
const CORE_DISABLED = 'disabled';
const DEFAULT_NAME = 'MultiTTS 默认声音（使用 APP 当前旁白）';
const TEST_TEXT = '你好，这是 MultiTTS 与 SillyTavern 的诊断测试。';
const TIMEOUT = 12000;
let registered = false;

const baseUrl = v => String(v || 'http://127.0.0.1:8774').trim().replace(/\/+$/, '').replace(/\/(voices|forward)$/i, '');
const defaultVoice = () => ({ name: DEFAULT_NAME, voice_id: DEFAULT_ID, lang: 'zh-CN' });
const err = e => e ? [e.name, e.message].filter(Boolean).join(': ') || String(e) : 'Unknown error';
const timeout = (p, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`${label} timeout`)), TIMEOUT))]);

function one(...xs) {
    const x = xs.find(v => v !== undefined && v !== null && String(v).trim() !== '');
    return x === undefined ? '' : String(x);
}

function voice(raw, i) {
    if (typeof raw === 'string' || typeof raw === 'number') return { name: String(raw), voice_id: String(raw), lang: 'zh-CN' };
    if (!raw || typeof raw !== 'object') return null;
    const id = one(raw.id, raw.voice_id, raw.voiceId, raw.voice, raw.value, raw.key, raw.name, i);
    if (!id) return null;
    const display = one(raw.name, raw.label, raw.displayName, raw.display_name, raw.title, id);
    return { name: display === id ? display : `${display} [${id}]`, voice_id: id, lang: one(raw.locale, raw.lang, raw.language, 'zh-CN') };
}

function parseVoices(json) {
    let list = [];
    // BaiTTS-CLI-rs confirmed shape: {success,data:{catalog:{provider:[{id,name,gender,locale,type}]}}}
    if (json?.data?.catalog && typeof json.data.catalog === 'object') list = Object.values(json.data.catalog).flatMap(x => Array.isArray(x) ? x : []);
    else if (Array.isArray(json)) list = json;
    else for (const k of ['voices', 'data', 'list', 'items', 'result']) if (Array.isArray(json?.[k])) { list = json[k]; break; }
    const seen = new Set();
    return list.map(voice).filter(Boolean).filter(v => !seen.has(v.voice_id) && seen.add(v.voice_id));
}

function forwardUrl(base, text, voiceId, s) {
    const u = new URL(`${baseUrl(base)}/forward`);
    u.searchParams.set('text', String(text ?? ''));
    u.searchParams.set('speed', String(s.speed));
    u.searchParams.set('volume', String(s.volume));
    u.searchParams.set('pitch', String(s.pitch));
    if (voiceId && voiceId !== DEFAULT_ID) u.searchParams.set('voice', String(voiceId));
    return u.toString();
}

function splitForMultiTts(text, maxChars = 70) {
    const chars = Array.from(String(text ?? '').replace(/\s+/g, ' ').trim());
    const max = Math.max(20, Math.min(200, Number(maxChars) || 70));
    if (chars.length <= max) return chars.length ? [chars.join('')] : [];

    const result = [];
    let start = 0;
    while (start < chars.length) {
        let end = Math.min(start + max, chars.length);
        if (end < chars.length) {
            // Prefer natural punctuation near the end of the chunk.
            const minBreak = start + Math.floor(max * 0.45);
            let cut = -1;
            for (let i = end - 1; i >= minBreak; i--) {
                if (/[。！？!?；;，,、：:]/.test(chars[i])) {
                    cut = i + 1;
                    break;
                }
            }
            if (cut > start) end = cut;
        }

        const chunk = chars.slice(start, end).join('').trim();
        if (chunk) result.push(chunk);
        start = end;
    }
    return result;
}

export class MultiTtsProvider {
    settings;
    voices = [defaultVoice()];
    separator = '。';
    audio = document.createElement('audio');
    logs = [];
    csp = [];
    cspHandler = null;
    defaultSettings = { voiceMap: {}, endpoint: 'http://127.0.0.1:8774', speed: 50, volume: 100, pitch: 50, chunkChars: 70, cachedVoices: [] };

    get settingsHtml() {
        return `<div class="multitts-settings">
          <div style="padding:8px;border:1px solid var(--SmartThemeBorderColor);border-radius:8px"><b>MultiTTS Diagnostic v${VERSION}</b><br><small>诊断版：先把浏览器、远程酒馆、MultiTTS 三层行为测清楚，再精简。</small></div>
          <label>本地地址</label><input id="mt_url" class="text_pole" value="http://127.0.0.1:8774">
          <label>语速 <span id="mt_sv">50</span></label><input id="mt_s" type="range" min="0" max="100" value="50">
          <label>音量 <span id="mt_vv">100</span></label><input id="mt_v" type="range" min="0" max="100" value="100">
          <label>音高 <span id="mt_pv">50</span></label><input id="mt_p" type="range" min="0" max="100" value="50">
          <label>长文本分块上限 <span id="mt_cv">70</span> 字</label><input id="mt_c" type="range" min="20" max="160" step="5" value="70">
          <small>正文超过这个长度时会按中文标点优先切成多个 /forward 请求，SillyTavern 会逐块排队播放。用于避开 MultiTTS 上游 10 秒超时。</small>
          <hr><b>实际可用性</b><div style="display:grid;gap:6px;margin:6px 0">
            <button type="button" id="mt_play" class="menu_button">① 测试默认声音（真正播放）</button>
            <button type="button" id="mt_voices" class="menu_button">② 读取 /voices 并导入音色</button>
            <button type="button" id="mt_diag" class="menu_button">③ 运行完整诊断</button>
            <button type="button" id="mt_open_v" class="menu_button">新标签页打开 /voices</button>
            <button type="button" id="mt_open_f" class="menu_button">新标签页打开 /forward</button>
          </div>
          <details><summary>高级：手动粘贴 /voices JSON（绕过 CORS）</summary>
            <textarea id="mt_json" class="text_pole" rows="5" placeholder="粘贴 /voices 返回的完整 JSON"></textarea>
            <button type="button" id="mt_import" class="menu_button">解析并缓存音色</button>
          </details>
          <hr><b>诊断状态</b><div id="mt_status" style="white-space:pre-wrap;margin:5px 0"></div>
          <pre id="mt_log" style="max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;padding:7px;border:1px solid var(--SmartThemeBorderColor);font-size:.82em"></pre>
          <div style="display:grid;gap:6px"><button type="button" id="mt_copy" class="menu_button">复制诊断报告</button><button type="button" id="mt_save" class="menu_button">下载诊断报告</button><button type="button" id="mt_clear" class="menu_button">清空日志</button></div>
          <small>日志不记录聊天正文。Voice Map 始终保留“${DEFAULT_NAME}”。</small>
        </div>`;
    }

    seedVoiceMap(saved) {
        const map = { ...((saved && saved.voiceMap) || this.settings?.voiceMap || {}) };

        // MultiTTS is intentionally used without voice=. The Android app owns narrator selection.
        // Make SillyTavern's own Voice Map resolve every current character to that one provider voice.
        map[CORE_DEFAULT] = DEFAULT_NAME;

        try {
            for (const name of getCharacters(false)) {
                if (!name || name === 'SillyTavern System' || name === CORE_DEFAULT) continue;
                const current = map[name];
                if (!current || current === CORE_DISABLED || current === CORE_DEFAULT) {
                    map[name] = DEFAULT_NAME;
                }
            }
        } catch (e) {
            this.log?.('WARN', `Could not enumerate current Voice Map characters: ${err(e)}`);
        }

        this.settings.voiceMap = map;

        // Mutate the object SillyTavern passed us as well, so initVoiceMap() sees the seeded values
        // immediately during provider loading.
        if (saved && typeof saved === 'object') {
            saved.voiceMap = { ...map };
        }

        return map;
    }

    async loadSettings(saved) {
        this.settings = { ...this.defaultSettings, ...(saved || {}), voiceMap: { ...((saved && saved.voiceMap) || {}) } };
        this.settings.endpoint = baseUrl(this.settings.endpoint);
        this.settings.cachedVoices = Array.isArray(this.settings.cachedVoices) ? this.settings.cachedVoices.map(voice).filter(Boolean) : [];
        this.voices = [defaultVoice(), ...this.settings.cachedVoices];
        this.seedVoiceMap(saved);
        $('#mt_url').val(this.settings.endpoint); $('#mt_s').val(this.settings.speed); $('#mt_v').val(this.settings.volume); $('#mt_p').val(this.settings.pitch); $('#mt_c').val(this.settings.chunkChars); this.labels();
        for (const id of ['#mt_url','#mt_s','#mt_v','#mt_p','#mt_c']) $(id).off('.mt').on('input.mt change.mt', () => this.saveUi());
        $('#mt_play').off('.mt').on('click.mt', () => this.testPlay());
        $('#mt_voices').off('.mt').on('click.mt', () => this.loadVoices(true));
        $('#mt_diag').off('.mt').on('click.mt', () => this.diagnose());
        $('#mt_open_v').off('.mt').on('click.mt', () => window.open(`${baseUrl(this.settings.endpoint)}/voices`, '_blank', 'noopener'));
        $('#mt_open_f').off('.mt').on('click.mt', () => window.open(forwardUrl(this.settings.endpoint, TEST_TEXT, DEFAULT_ID, this.settings), '_blank', 'noopener'));
        $('#mt_import').off('.mt').on('click.mt', () => this.manualImport());
        $('#mt_copy').off('.mt').on('click.mt', () => this.copyReport());
        $('#mt_save').off('.mt').on('click.mt', () => this.saveReport());
        $('#mt_clear').off('.mt').on('click.mt', () => { this.logs=[]; this.csp=[]; this.render(); });
        this.cspHandler = e => { const x={directive:e.effectiveDirective||e.violatedDirective,blockedURI:e.blockedURI}; this.csp.push(x); this.log('CSP', `${x.directive} blocked ${x.blockedURI}`); };
        document.addEventListener('securitypolicyviolation', this.cspHandler);
        this.log('INFO', `Provider v${VERSION} loaded; cached voices=${this.settings.cachedVoices.length}`);
        this.log('INFO', 'Seeded SillyTavern Voice Map to MultiTTS APP-default voice', { voiceMap: this.settings.voiceMap });
        this.status('默认模式：不请求 voice 参数，由 MultiTTS APP 自己决定声音。', true);

        // Rebuild SillyTavern's native Voice Map now, so manual narration has an entry for Assistant/character.
        try {
            await initVoiceMap(false);
        } catch (e) {
            this.log('WARN', `initVoiceMap during provider load: ${err(e)}`);
        }
    }

    dispose() { if (this.cspHandler) document.removeEventListener('securitypolicyviolation', this.cspHandler); try { this.audio.pause(); } catch {} }
    labels() { $('#mt_sv').text(this.settings.speed); $('#mt_vv').text(this.settings.volume); $('#mt_pv').text(this.settings.pitch); $('#mt_cv').text(this.settings.chunkChars); }
    saveUi() { this.settings.endpoint=baseUrl($('#mt_url').val()); this.settings.speed=+$('#mt_s').val(); this.settings.volume=+$('#mt_v').val(); this.settings.pitch=+$('#mt_p').val(); this.settings.chunkChars=Math.max(20,Math.min(160,+$('#mt_c').val()||70)); this.labels(); saveTtsProviderSettings(); }
    log(level, msg, data) { const line=`[${new Date().toLocaleTimeString()}] [${level}] ${msg}${data===undefined?'':`\n${JSON.stringify(data,null,2)}`}`; this.logs.push(line); this.render(); (level==='ERROR'||level==='CSP'?console.warn:console.info)('[MultiTTS]',msg,data??''); }
    render() { const e=$('#mt_log'); if(e.length){e.text(this.logs.join('\n')); const n=e.get(0); if(n)n.scrollTop=n.scrollHeight;} }
    status(s, ok) { $('#mt_status').text(s).css('color', ok?'':'var(--warning-color,#d9a441)'); }

    // Critical: core calls this automatically. Do NOT network here; CORS must never break provider initialization.
    async checkReady() { return true; }
    async fetchTtsVoiceObjects() { return this.voices; }
    async onRefreshClick() { await this.loadVoices(true); return this.voices; }
    async getVoice(name) { const n=String(name||DEFAULT_ID); return this.voices.find(v=>v.name===n||v.voice_id===n) || (n?{name:n,voice_id:n,lang:'zh-CN'}:defaultVoice()); }

    async cacheVoices(list, source) {
        this.settings.cachedVoices = list.filter(v => v.voice_id !== DEFAULT_ID).map(v=>({name:v.name,voice_id:v.voice_id,lang:v.lang}));
        this.voices = [defaultVoice(), ...this.settings.cachedVoices]; saveTtsProviderSettings(); await initVoiceMap(false);
        this.log('OK', `${source}: cached ${this.settings.cachedVoices.length} voices and refreshed Voice Map`);
    }

    async loadVoices(showToast=false) {
        const url=`${baseUrl(this.settings.endpoint)}/voices`; this.log('TEST', `CORS fetch ${url}`);
        try {
            const r=await timeout(fetch(url,{mode:'cors',cache:'no-store',credentials:'omit'}),'voices fetch');
            this.log('OK', `/voices HTTP=${r.status} type=${r.type} content-type=${r.headers.get('content-type')||''}`);
            const text=await r.text(); const json=JSON.parse(text); const list=parseVoices(json);
            this.log('INFO','/voices structure',{success:json?.success,topKeys:Object.keys(json||{}),catalogGroups:Object.keys(json?.data?.catalog||{}).length,bodyLength:text.length,parsed:list.length});
            if(json?.success===false) throw new Error('success=false'); if(!list.length) throw new Error('no voices parsed');
            await this.cacheVoices(list,'/voices'); this.status(`成功读取并导入 ${list.length} 个音色。`,true); if(showToast)toastr.success(`已导入 ${list.length} 个音色`,'MultiTTS'); return true;
        } catch(e) { this.log('ERROR',`/voices CORS read failed: ${err(e)}`); this.status('读取 /voices 失败；默认声音仍可用。运行完整诊断可区分 CORS / 本地网络权限 / CSP。',false); if(showToast)toastr.warning('读取 /voices 失败，请看诊断日志','MultiTTS'); return false; }
    }

    async manualImport() {
        try { const json=JSON.parse(String($('#mt_json').val()||'')); const list=parseVoices(json); if(!list.length)throw new Error('no voices parsed'); await this.cacheVoices(list,'manual JSON'); this.status(`手动导入成功：${list.length} 个音色。`,true); }
        catch(e){this.log('ERROR',`manual JSON: ${err(e)}`);this.status(`手动导入失败：${err(e)}`,false);}
    }

    async *generateTts(text, voiceId) {
        const chunks = splitForMultiTts(text, this.settings.chunkChars);
        this.log('TTS','queue direct audio URL chunks',{
            voice:voiceId===DEFAULT_ID?'(omitted/API default)':voiceId,
            textLength:Array.from(String(text??'')).length,
            chunks:chunks.length,
            chunkChars:this.settings.chunkChars,
            chunkLengths:chunks.map(x=>Array.from(x).length),
            speed:this.settings.speed,
            volume:this.settings.volume,
            pitch:this.settings.pitch
        });

        for (let i = 0; i < chunks.length; i++) {
            const u = forwardUrl(this.settings.endpoint, chunks[i], voiceId, this.settings);
            this.log('TTS',`yield chunk ${i + 1}/${chunks.length}`,{length:Array.from(chunks[i]).length});
            yield u;
        }
    }

    async previewTtsVoice(voiceId) { return this.playAudio(voiceId,'voice preview'); }
    async testPlay() { try { await this.playAudio(DEFAULT_ID,'default playback'); this.status('播放成功：SillyTavern 直接 /forward URL 路线可用。',true); } catch(e){this.status(`播放失败：${err(e)}`,false);} }

    async playAudio(id,label) {
        const a=this.audio; a.pause(); a.removeAttribute('crossorigin'); a.src=forwardUrl(this.settings.endpoint,TEST_TEXT,id,this.settings); this.log('TEST',`${label}: <audio src=/forward> no crossorigin`);
        const p=new Promise((resolve,reject)=>{const ok=()=>{clean();this.log('OK',`${label}: playing`);resolve();};const bad=()=>{clean();reject(new Error(`media error code=${a.error?.code||'?'}, message=${a.error?.message||''}`));};const clean=()=>{a.removeEventListener('playing',ok);a.removeEventListener('error',bad);};a.addEventListener('playing',ok);a.addEventListener('error',bad);});
        try { await a.play(); await timeout(p,label); } catch(e){this.log('ERROR',`${label}: ${err(e)}`);throw e;}
    }

    async perm(name) { try { return {name,state:(await navigator.permissions.query({name})).state}; } catch(e){return{name,state:`unsupported: ${err(e)}`};} }
    async fetchTest(label,url,mode) { this.log('TEST',`${label}: mode=${mode}`); try {const r=await timeout(fetch(url,{mode,cache:'no-store',credentials:'omit'}),label); const x={ok:true,type:r.type,status:r.status,contentType:mode==='cors'?r.headers.get('content-type')||'':''}; this.log('OK',label,x); return {...x,response:r};} catch(e){const x={ok:false,error:err(e)};this.log('ERROR',label,x);return x;} }

    async mediaLoadTest(url) {
        this.log('TEST','media load: <audio preload> wait canplay, no crossorigin'); const a=document.createElement('audio');a.preload='auto';a.removeAttribute('crossorigin');
        const p=new Promise((resolve,reject)=>{const ok=()=>{clean();resolve(true);};const bad=()=>{clean();reject(new Error(`media code=${a.error?.code||'?'}`));};const clean=()=>{a.removeEventListener('canplay',ok);a.removeEventListener('error',bad);};a.addEventListener('canplay',ok);a.addEventListener('error',bad);a.src=url;a.load();});
        try{await timeout(p,'media canplay');this.log('OK','media /forward canplay');return true;}catch(e){this.log('ERROR',`media /forward: ${err(e)}`);return false;}finally{try{a.pause();a.removeAttribute('src');a.load();}catch{}}
    }

    async diagnose() {
        this.status('诊断中。若 Chrome 弹出访问本地网络/本地设备权限，请允许。',true); this.log('INFO','========== FULL DIAGNOSTIC START ==========');
        const b=baseUrl(this.settings.endpoint), vu=`${b}/voices`, fu=forwardUrl(b,TEST_TEXT,DEFAULT_ID,this.settings);
        let addrSpace; try {const q=new Request(vu,{targetAddressSpace:'loopback'});addrSpace={accepted:true,value:'targetAddressSpace'in q?q.targetAddressSpace:'not exposed'};}catch(e){addrSpace={accepted:false,error:err(e)};}
        const policy=document.permissionsPolicy||document.featurePolicy; const pp={}; for(const f of ['loopback-network','local-network','local-network-access'])try{pp[f]=policy?.allowsFeature?policy.allowsFeature(f):'API unavailable';}catch(e){pp[f]=`error:${err(e)}`;}
        this.log('ENV','browser',{version:VERSION,origin:location.origin,protocol:location.protocol,secureContext:window.isSecureContext,topLevel:window.top===window.self,userAgent:navigator.userAgent,endpoint:b,requestAddressSpace:addrSpace,permissionsPolicy:pp});
        const names=['loopback-network','local-network','local-network-access']; const pre=[]; for(const n of names)pre.push(await this.perm(n)); this.log('ENV','permissions before',pre);
        const vnc=await this.fetchTest('A /voices no-cors',vu,'no-cors'); const vc=await this.fetchTest('B /voices cors',vu,'cors'); let parsed=0;
        if(vc.ok){try{const text=await vc.response.text();const json=JSON.parse(text);const list=parseVoices(json);parsed=list.length;this.log('INFO','B /voices JSON',{success:json?.success,catalogGroups:Object.keys(json?.data?.catalog||{}).length,bodyLength:text.length,parsed});if(parsed)await this.cacheVoices(list,'diagnostic /voices');}catch(e){this.log('ERROR',`B /voices parse: ${err(e)}`);}}
        const fnc=await this.fetchTest('C /forward no-cors',fu,'no-cors'); const fc=await this.fetchTest('D /forward cors',fu,'cors'); if(fc.ok){try{const blob=await fc.response.blob();this.log('INFO','D /forward blob',{size:blob.size,type:blob.type});}catch(e){this.log('ERROR',`D blob: ${err(e)}`);}}
        const media=await this.mediaLoadTest(fu); const post=[]; for(const n of names)post.push(await this.perm(n)); this.log('ENV','permissions after',post);
        const blocked=this.csp.filter(x=>/127\.0\.0\.1|localhost|8774/i.test(x.blockedURI||'')); if(blocked.length)this.log('CSP','relevant CSP violations',blocked);
        const out=[]; out.push(media?'✓ /forward 可作为音频子资源加载；直接 URL TTS 路线成立。':'✗ /forward 新标签页虽可能可开，但音频子资源加载失败。');
        if(vc.ok&&parsed)out.push(`✓ /voices 可被网页 JS 读取并解析：${parsed} 个音色。`); else if(vnc.ok&&!vc.ok)out.push('△ /voices no-cors 成功、cors 失败：服务可达，但 CORS 不允许页面读取响应的可能性很高。'); else if(!vnc.ok&&!vc.ok)out.push('△ /voices 两种 fetch 都失败：优先看 loopback/local-network 权限、CSP connect-src、浏览器本地网络策略。'); else out.push('△ /voices 响应可读但音色结构未成功解析，请把日志给我。');
        if(fnc.ok&&!fc.ok&&media)out.push('△ /forward JS 无法读响应，但 <audio> 能加载；这正是直接 URL 方案要绕开的限制。'); if(blocked.length)out.push('✗ 检测到站点 CSP 明确阻止本地地址。');
        this.log('RESULT','conclusion',out); this.status(out.join('\n'),media); this.log('INFO','========== FULL DIAGNOSTIC END ==========');
    }

    report() { return `SillyTavern MultiTTS Diagnostic\nPlugin: ${VERSION}\nGenerated: ${new Date().toISOString()}\nOrigin: ${location.origin}\nEndpoint: ${baseUrl(this.settings.endpoint)}\nChunk chars: ${this.settings.chunkChars}\n\n${this.logs.join('\n')}`; }
    async copyReport(){try{await navigator.clipboard.writeText(this.report());this.status('诊断报告已复制。',true);}catch(e){this.log('ERROR',`copy report: ${err(e)}`);}}
    saveReport(){const u=URL.createObjectURL(new Blob([this.report()],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=`multitts-diagnostic-${Date.now()}.txt`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}
}

function ensureOption(){const s=document.getElementById('tts_provider');if(!s)return;const a=s.querySelectorAll(`option[value="${NAME}"]`);if(!a.length){const o=document.createElement('option');o.value=NAME;o.textContent=NAME;s.appendChild(o);}else for(let i=1;i<a.length;i++)a[i].remove();}
function register(){ensureOption();for(const ms of [0,500,1500,3000])setTimeout(ensureOption,ms);if(registered)return;try{registerTtsProvider(NAME,MultiTtsProvider);registered=true;console.info(`[MultiTTS] v${VERSION} registered`);}catch(e){console.warn('[MultiTTS] register failed',e);}}
export function init(){register();}
try{if(eventSource&&event_types?.APP_READY)eventSource.on(event_types.APP_READY,ensureOption);}catch{}
register();
