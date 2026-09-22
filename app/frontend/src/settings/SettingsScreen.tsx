// Seam 24 (settings) — THE SETTINGS SCREEN, READ-ONLY IN PHASE 03.
//
// PORTED FROM (by symbol, app.js): fillSettingsForm, loadSettings, loadGeneralSettings,
// refreshProviderStatus, adminToken, rememberAdminToken, showSettings.
//
// ⛔ `GET /api/settings` and `GET /api/general` are read routes and are in scope.
//    `saveSettings()` is a WRITE and is NOT — the Save button renders DISABLED.
//
// ⛔⛔ :8792 IS UNAUTHENTICATED AND ufw RULE #1 BLANKET-ALLOWS THE WHOLE LAN. The unit
//     carries ZERO credential variables and no EnvironmentFile=, and the G-SEP gate
//     asserts exactly that. ⛔ Never render a secret this screen received, never echo an
//     admin token back into the DOM, and never store one in localStorage on this origin.
//     The legacy app's #api-key-state / #access-token-state show a STATE ("set" /
//     "not set"), never a value — keep it that way.
// ⚑ A2 (22-09-26): these read the DERIVED selectors, not the raw query data. The raw wire
//    keys are snake_case (ai_question_count / fresh_quiz_size / token_required) and A1 read
//    camelCase names that no response carries — every field rendered blank. The defaults
//    (5 / 20) also belong in the derivation, so a server that omits a key shows the value
//    the app actually uses rather than an empty box.
import { useProviderReadiness, useQuizSizing } from '../data/queries';

export function SettingsScreen() {
  const { aiQuestionCount, generatedQuizSize } = useQuizSizing();
  const provider = useProviderReadiness();

  return (
    <form id="settings-form" onSubmit={(event) => event.preventDefault()}>
      <p id="settings-lock-status">
        {provider.tokenRequired ? 'Locked — an admin token is required.' : 'Unlocked.'}
      </p>
      <div id="settings-lock-card">
        <input id="admin-token" type="password" autoComplete="off" />
        <button id="settings-unlock-btn" type="button" disabled>
          Unlock
        </button>
      </div>

      {/* A3 ports the full form. The two STATE fields below never show a value. */}
      <p id="api-key-state">{/* "set" / "not set" — ⛔ never the key itself. */}</p>
      <p id="access-token-state">{/* "set" / "not set" — ⛔ never the token itself. */}</p>
      <p id="set-model">{provider.model}</p>
      <p id="set-ai-count">{String(aiQuestionCount)}</p>
      <p id="set-fresh-size">{String(generatedQuizSize)}</p>

      {/* ⛔ DISABLED: saving is a write, and Phase 03's bundle must contain none. */}
      <button id="settings-save-btn" type="submit" disabled title="Saving is not available in this phase yet.">
        Save
      </button>
      <p id="settings-status" />
    </form>
  );
}
