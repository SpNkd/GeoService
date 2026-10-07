import { safeDiagnostic, type AiDiagnostic } from './reliability';
/** Transient, pre-redacted diagnostics; never credentials, PreferencesStore or document persistence. */
let latest:AiDiagnostic|null=null;
export const publishAiDiagnostic=(record:AiDiagnostic)=>{latest=safeDiagnostic(record);};
export const readAiDiagnostic=()=>latest;
