// 0018: an AI connection can be marked as the provider's free plan («طرح رایگان»: Gemini through a Google AI Studio
// key without billing, OpenRouter's free models, Groq's free tier…). Its calls are recorded at zero cost, so the usage
// page shows what was really spent and the budget caps keep guarding the paid connections only. AI tables are local
// to each runtime (not synced), so this needs no sync trigger.
export default /* sql */ `
alter table tz_ai_connections add column if not exists free_tier boolean not null default false;
`;
