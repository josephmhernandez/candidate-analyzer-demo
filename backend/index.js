const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secrets = new SecretsManagerClient({});
let storedSecrets;

function response(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
}

async function getStoredSecrets() {
  if (storedSecrets) return storedSecrets;
  try {
    const value = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ID }));
    storedSecrets = JSON.parse(value.SecretString || '{}');
  } catch { storedSecrets = {}; }
  return storedSecrets;
}

async function github(path) {
  const saved = await getStoredSecrets();
  const token = saved['github.api.pat'] || '';
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'swe-lens-portfolio-demo' };
  if (token) headers.authorization = `Bearer ${token}`;
  let result = await fetch(`https://api.github.com${path}`, { headers });
  if (result.status === 401 && headers.authorization) {
    delete headers.authorization;
    saved['github.api.pat'] = '';
    result = await fetch(`https://api.github.com${path}`, { headers });
  }
  if (!result.ok) throw new Error(`GitHub returned ${result.status}`);
  return result.json();
}

async function repoEvidence(username) {
  if (!username) return [];
  const safe = username.replace(/^https?:\/\/github\.com\//, '').split('/')[0].trim();
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(safe)) throw new Error('Enter a valid GitHub username.');
  const repos = (await github(`/users/${safe}/repos?sort=updated&per_page=50`))
    .filter(repo => !repo.fork && !repo.archived)
    .sort((a, b) => (b.stargazers_count + b.forks_count) - (a.stargazers_count + a.forks_count))
    .slice(0, 3);
  return Promise.all(repos.map(async repo => {
    let readme = '';
    try {
      const file = await github(`/repos/${safe}/${repo.name}/readme`);
      readme = Buffer.from(file.content || '', 'base64').toString('utf8').slice(0, 3000);
    } catch {}
    return { name: repo.name, url: repo.html_url, description: repo.description, language: repo.language, stars: repo.stargazers_count, forks: repo.forks_count, updatedAt: repo.updated_at, topics: repo.topics || [], readme };
  }));
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned);
}

async function analyzeWithGemini(prompt) {
  const saved = await getStoredSecrets();
  const apiKey = saved['google.api.key'];
  if (!apiKey) throw new Error('Google model credential is unavailable.');
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'Be rigorous, concise, evidence-based, and safe for an employment-support context. Output JSON only.' }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 3000, temperature: 0.1, responseMimeType: 'application/json' }
    })
  });
  const data = await result.json();
  if (!result.ok) throw new Error(`Gemini returned ${result.status}: ${data.error?.message || 'unknown error'}`);
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
}

exports.handler = async event => {
  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return response(400, { error: 'Invalid JSON.' }); }
  const resume = String(input.resume || '').trim().slice(0, 18000);
  const job = String(input.job || '').trim().slice(0, 12000);
  const username = String(input.github || '').trim().slice(0, 80);
  if (resume.length < 80 || job.length < 50) return response(400, { error: 'Add a résumé and target job description.' });
  try {
    const repositories = await repoEvidence(username);
    const prompt = `You are the backend analysis workflow for SWE Lens, a software-engineering candidate evidence analyzer. Analyze evidence; do not make a hire/reject decision and do not infer protected traits. Compare the résumé, job requirements, and public repository evidence. Penalize unsupported claims and distinguish a missing signal from a negative signal. Return ONLY valid JSON matching this schema exactly:
{"overallScore":0,"headline":"","summary":"","categories":[{"name":"Role alignment","score":0,"max":35,"explanation":""},{"name":"Engineering evidence","score":0,"max":35,"explanation":""},{"name":"Project depth","score":0,"max":20,"explanation":""},{"name":"Public proof","score":0,"max":10,"explanation":""}],"matchedSkills":[""],"gaps":[""],"recommendations":[""],"repositoryFindings":[{"name":"","url":"","finding":""}]}
Scores must sum to overallScore and remain within each maximum. Recommendations must be concrete, truthful résumé or portfolio improvements.

TARGET JOB:\n${job}\n\nRÉSUMÉ:\n${resume}\n\nPUBLIC GITHUB EVIDENCE:\n${JSON.stringify(repositories)}`;
    const text = await analyzeWithGemini(prompt);
    return response(200, { report: parseJson(text), analyzedRepositories: repositories.map(({ readme, ...repo }) => repo), model: 'Google Gemini Flash · backend AI workflow' });
  } catch (error) {
    console.error(error);
    return response(500, { error: 'The backend analysis could not finish. Please try again.' });
  }
};
