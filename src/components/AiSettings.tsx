import { Dialog } from './Dialog';
import '../ai/settings.css';
import { useEffect, useRef, useState } from 'react';
import { HttpAiIntentProvider, type ProviderMode } from '../ai/provider';
import { aiSettingsSchema, setAiSettings, type AiSettings } from '../ai/settings';
interface Props { mode: ProviderMode; onStatus: (enabled: boolean, label: string) => void; onChange: () => void }
export function AiSettingsPanel({ mode, onStatus, onChange }: Props) {
  const [settings, setSettings] = useState<AiSettings>({ enabled: mode !== 'disabled', provider: mode === 'openai' || mode === 'mock' ? mode : 'openrouter', apiKey: '', primaryModel: 'qwen/qwen3.5-27b', fallbackModel: 'qwen/qwen3-30b-a3b-instruct-2507' });
  const [open,setOpen]=useState(false);
  const [test, setTest] = useState(''), [testing, setTesting] = useState(false);
  const connection = useRef<AbortController | null>(null), edited = useRef(false);
  useEffect(() => () => { connection.current?.abort(); connection.current = null; }, []);
  useEffect(() => { const controller = new AbortController(); void fetch('/api/ai/settings', { signal: controller.signal }).then(async r => { if (!r.ok) return; const data = await r.json() as { primaryModel?: string; fallbackModel?: string }; if (controller.signal.aborted || edited.current) return; setSettings(previous => ({ ...previous, ...(data.primaryModel ? { primaryModel: data.primaryModel } : {}), ...(data.fallbackModel ? { fallbackModel: data.fallbackModel } : {}) })); }).catch(() => {}); return () => controller.abort(); }, []);
  const update = (patch: Partial<AiSettings>) => { edited.current = true; connection.current?.abort(); connection.current = null; setTesting(false); const next = { ...settings, ...patch }; setSettings(next); setTest(''); onChange(); const valid = aiSettingsSchema.safeParse(next); if (valid.success) { setAiSettings(next); onStatus(next.enabled, next.enabled ? `${next.primaryModel.split('/').at(-1)} · не проверен` : 'AI отключён'); } else { onStatus(false, 'Проверьте настройки AI'); } };
  const check = async () => { const valid = aiSettingsSchema.safeParse(settings); if (!valid.success) { setTest('Проверьте модель и ключ.'); return; } setAiSettings(settings); setTesting(true); setTest('Проверка…');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000); connection.current = controller;
    try { await new HttpAiIntentProvider().parseIntent({ text: 'Нарисуй прямоугольник 1x1 м', signal: controller.signal }); if(controller.signal.aborted)return; setTest('Соединение проверено.'); onStatus(true, settings.provider==='mock'?'Демо · локально':`${settings.primaryModel.split('/').at(-1)} · online`); }
    catch { if(controller.signal.aborted)return; setTest('Не удалось подключиться. Проверьте ключ, модель и локальный AI backend.'); onStatus(false, 'AI · недоступен'); }
    finally { clearTimeout(timer); if (connection.current === controller) { connection.current = null; setTesting(false); } }
  };
  return <><button className="secondary-action" onClick={()=>setOpen(true)}>Настройки AI</button>{open&&<Dialog title="Настройки AI" size="md" onClose={()=>setOpen(false)} onDismiss={()=>setOpen(false)} footer={<button onClick={()=>setOpen(false)}>Готово</button>}><div className="ai-settings-body">
    <label><input aria-label="AI включён" type="checkbox" checked={settings.enabled} onChange={e => update({ enabled: e.target.checked })} />AI включён</label>
    <label>Provider<select aria-label="AI provider" value={settings.provider} onChange={e => update({ provider: e.target.value as AiSettings['provider'] })}><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option><option value="mock">Демонстрационный mock</option></select></label>
    <label>API key<input aria-label="AI API key" type="password" autoComplete="off" spellCheck={false} value={settings.apiKey} onChange={e => update({ apiKey: e.target.value })} placeholder="Пусто — конфигурация локального сервера" /></label>
    <small>Введённый ключ хранится только в памяти этой вкладки до перезагрузки. В JSON и автосохранение он не попадает.</small>
    <label>Основная модель<input aria-label="Основная AI модель" value={settings.primaryModel} onChange={e => update({ primaryModel: e.target.value })} spellCheck={false} /></label><label>Резервная модель<input aria-label="Резервная AI модель" value={settings.fallbackModel} onChange={e => update({ fallbackModel: e.target.value })} spellCheck={false} /></label>
    <button className="secondary-action" disabled={testing || !settings.enabled} onClick={() => void check()}>Проверить подключение</button><p role="status">{test}</p>
    <label>Приватность<select aria-label="Приватность AI" value="prompt" onChange={() => {}}><option value="prompt">Только текст запроса</option><option value="semantic" disabled>Semantic Assist · позже</option></select></label><label><input type="checkbox" disabled checked={false} readOnly />AI-анализ изображения · недоступен в V1</label><p>Проверка отправляет только короткий тестовый запрос. Изображения и геометрия не отправляются.</p>
  </div></Dialog>}</>;
}
