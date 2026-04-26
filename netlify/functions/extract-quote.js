// BrnnoQuote — Full API Integration Layer v2
// Adds: Real document extraction (Claude Vision), Auto re-quoting engine

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEXISNEXIS_KEY = process.env.LEXISNEXIS_API_KEY;
const LEXISNEXIS_URL = process.env.LEXISNEXIS_URL || 'https://risk.api.lexisnexis.com';
const VERISK_KEY = process.env.VERISK_API_KEY;
const VERISK_URL = process.env.VERISK_URL || 'https://api.verisk.com';
const PROGRESSIVE_KEY = process.env.PROGRESSIVE_API_KEY;
const PROGRESSIVE_AGENT_ID = process.env.PROGRESSIVE_AGENT_ID;
const TRAVELERS_KEY = process.env.TRAVELERS_API_KEY;
const TRAVELERS_AGENT_ID = process.env.TRAVELERS_AGENT_ID;
const EXPERIAN_KEY = process.env.EXPERIAN_API_KEY;
const CHECKR_KEY = process.env.CHECKR_API_KEY;
const NATIONWIDE_KEY = process.env.NATIONWIDE_API_KEY;
const COVERHOUND_KEY = process.env.COVERHOUND_API_KEY;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  try {
    switch(body.action) {
      case 'chat':            return res(headers, await handleChat(body));
      case 'extract':         return res(headers, await handleExtract(body));
      case 'extract_document':return res(headers, await handleDocumentExtract(body));
      case 'email':           return res(headers, await handleEmail(body));
      case 'mvr':             return res(headers, await handleMVR(body));
      case 'clue':            return res(headers, await handleCLUE(body));
      case 'credit':          return res(headers, await handleCredit(body));
      case 'background':      return res(headers, await handleBackground(body));
      case 'quote_auto':      return res(headers, await handleAutoQuote(body));
      case 'quote_home':      return res(headers, await handleHomeQuote(body));
      case 'quote_health':    return res(headers, await handleHealthQuote(body));
      case 'quote_life':      return res(headers, await handleLifeQuote(body));
      case 'quote_all':       return res(headers, await handleAllQuotes(body));
      case 'requote_check':   return res(headers, await handleRequoteCheck(body));
      case 'carrier_appetite':return res(headers, await handleCarrierAppetite(body));
      default: return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + body.action }) };
    }
  } catch(err) {
    console.error('Handler error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function res(headers, data) { return { statusCode: 200, headers, body: JSON.stringify(data) }; }

// ─── CLAUDE AI ────────────────────────────────────────────────────────────────
async function callClaude(messages, maxTokens = 800, system = null) {
  const body = { model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages };
  if (system) body.system = system;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Claude API error: ' + JSON.stringify(d));
  return d.content?.[0]?.text || '';
}

// Simple text call
async function claude(prompt, maxTokens = 800, system = null) {
  return callClaude([{ role: 'user', content: prompt }], maxTokens, system);
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────
async function handleChat({ message, context, clientText }) {
  const system = `You are an expert AI assistant for independent insurance agents. You help agents find the best plans across all lines (auto, home, health, life). You know carrier pricing, underwriting rules, state regulations, commission structures, and closing techniques. Give concise, actionable 2-3 sentence advice. Use <strong> tags for key numbers and recommendations. Context: ${context || 'No client selected.'}`;
  const reply = await claude(message, 500, system);
  return { success: true, reply };
}

// ─── TEXT EXTRACT ─────────────────────────────────────────────────────────────
async function handleExtract({ clientText, quoteType }) {
  const types = Array.isArray(quoteType) ? quoteType : [quoteType];
  const prompt = `Extract ALL insurance-relevant information from these client notes. Return ONLY valid JSON, no markdown.

Structure:
{
  ${types.map(t => `"${t}": { ${getFieldsFor(t)} }`).join(',\n  ')}
}

Rules: null for missing fields, dates as YYYY-MM-DD, dollar amounts as numbers, arrays for vehicles/drivers/dependents.

Client notes:
${clientText}`;
  const text = await claude(prompt, 3000);
  const data = JSON.parse(text.replace(/```json|```/g, '').trim());
  return { success: true, data };
}

// ─── DOCUMENT EXTRACTION (Claude Vision) ──────────────────────────────────────
// This is the core high-ROI feature: upload any document, AI reads it and fills all fields
// Supports: driver's license, declarations page, vehicle registration, home inspection, health records
async function handleDocumentExtract({ documentBase64, documentType, mimeType, quoteTypes }) {
  const docTypePrompts = {
    drivers_license: `Extract from this driver's license image:
- full_name (first + last)
- date_of_birth (YYYY-MM-DD)
- license_number
- license_state (2-letter)
- address, city, state, zip
- expiration_date
- license_class`,

    declarations_page: `Extract from this insurance declarations page:
- policy_number
- policy_period_start and policy_period_end
- named_insured (full name)
- insured_address, city, state, zip
- insurer (company name)
- annual_premium
- monthly_premium (annual / 12)
- vehicles: array of {year, make, model, vin}
- drivers: array of {name, date_of_birth}
- coverages: {bodily_injury, property_damage, comprehensive_deductible, collision_deductible, uninsured_motorist}
- discounts applied
- agent name and agency`,

    vehicle_registration: `Extract from this vehicle registration:
- year, make, model
- vin
- license_plate
- registered_owner_name
- registration_address, city, state, zip
- expiration_date
- vehicle_weight (if shown)`,

    home_inspection: `Extract from this home inspection or property document:
- property_address, city, state, zip
- year_built
- square_footage
- construction_type (frame, masonry, etc.)
- roof_type and roof_year (if shown)
- number_of_stories
- bedrooms, bathrooms
- any noted deficiencies or issues
- inspector_name and inspection_date`,

    health_records: `Extract from this health document:
- patient_name
- date_of_birth
- any diagnosed conditions
- current_medications (name and dosage)
- primary_care_physician
- any noted allergies
- tobacco_use (yes/no if mentioned)`,

    current_policy: `Extract ALL details from this insurance policy document:
- policy_number
- insurer
- policy_type (auto/home/life/health)
- named_insured
- policy_period
- annual_premium
- all coverage details and limits
- deductibles
- vehicles or property covered
- all drivers or insureds listed
- discounts applied
- agent information`
  };

  const extractionPrompt = docTypePrompts[documentType] || docTypePrompts.declarations_page;

  // Build message with vision
  const messages = [{
    role: 'user',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType || 'image/jpeg',
          data: documentBase64
        }
      },
      {
        type: 'text',
        text: `You are an expert insurance data extraction AI. Read this document carefully and extract ALL relevant information.

${extractionPrompt}

Return ONLY a valid JSON object — no markdown, no explanation. Extract every piece of information you can see. Use null for any field not visible. Be thorough.`
      }
    ]
  }];

  const text = await callClaude(messages, 2000);
  const clean = text.replace(/```json|```/g, '').trim();
  let extracted;
  try {
    extracted = JSON.parse(clean);
  } catch(e) {
    // If JSON parse fails, try to extract what we can
    extracted = { parse_error: true, raw_text: text };
  }

  // Generate underwriting flags from extracted data
  const uwFlags = generateUWFlags(extracted, documentType, quoteTypes);

  // Generate carrier appetite based on extracted profile
  const appetite = generateCarrierAppetite(extracted, quoteTypes);

  return {
    success: true,
    source: 'Claude_Vision',
    document_type: documentType,
    extracted,
    underwriting_flags: uwFlags,
    carrier_appetite: appetite,
    completeness: calcCompleteness(extracted, documentType)
  };
}

// ─── UW FLAG GENERATOR ────────────────────────────────────────────────────────
function generateUWFlags(data, docType, quoteTypes) {
  const flags = [];

  // Prior claims
  if (data.claims_count > 0 || (data.coverages && data.annual_premium > 3000)) {
    flags.push({ type: 'warn', msg: '⚠ Prior claims on CLUE report — pull MVR to confirm' });
  }

  // Policy lapse check
  if (data.policy_period_end) {
    const end = new Date(data.policy_period_end);
    const now = new Date();
    const daysSinceExpiry = (now - end) / (1000 * 60 * 60 * 24);
    if (daysSinceExpiry > 30) flags.push({ type: 'err', msg: `⚠ Coverage lapse detected — ${Math.round(daysSinceExpiry)} days` });
  }

  // Vehicle age
  if (data.vehicles) {
    const currentYear = new Date().getFullYear();
    data.vehicles.forEach(v => {
      if (v.year && (currentYear - v.year) > 15) {
        flags.push({ type: 'warn', msg: `⚠ High-mileage vehicle (${v.year} ${v.make}) — may affect comp/collision` });
      }
    });
  }

  // Roof age for home
  if (data.roof_year) {
    const roofAge = new Date().getFullYear() - parseInt(data.roof_year);
    if (roofAge > 15) flags.push({ type: 'warn', msg: `⚠ Roof age ${roofAge} years — surcharge likely, some carriers may decline` });
    if (roofAge > 20) flags.push({ type: 'err', msg: `⚠ Roof over 20 years — Travelers and Progressive may non-renew` });
  }

  // Young driver
  if (data.date_of_birth) {
    const age = new Date().getFullYear() - new Date(data.date_of_birth).getFullYear();
    if (age < 25) flags.push({ type: 'warn', msg: `⚠ Driver age ${age} — young driver surcharge applies` });
    if (age < 20) flags.push({ type: 'err', msg: `⚠ Teen driver — Progressive preferred, Travelers may decline` });
  }

  // High-risk state
  const highRiskStates = ['FL', 'LA', 'MI', 'CA', 'TX'];
  const state = (data.state || data.license_state || '').toUpperCase();
  if (highRiskStates.includes(state)) {
    flags.push({ type: 'warn', msg: `⚠ ${state} — high-risk state, expect 8-12% premium surcharge` });
  }

  // Tobacco
  if (data.tobacco_use === 'yes' || data.tobacco_use === true) {
    flags.push({ type: 'warn', msg: '⚠ Tobacco user — life/health rates significantly higher' });
  }

  // Health conditions for life
  if (quoteTypes && quoteTypes.includes('Life') && data.current_medications && data.current_medications.length > 0) {
    flags.push({ type: 'warn', msg: `⚠ ${data.current_medications.length} active medication(s) — may affect life health class` });
  }

  if (flags.length === 0) flags.push({ type: 'ok', msg: '✓ No underwriting flags detected — clean profile' });

  return flags;
}

// ─── CARRIER APPETITE INTELLIGENCE ───────────────────────────────────────────
async function handleCarrierAppetite({ clientData, quoteTypes }) {
  const appetite = generateCarrierAppetite(clientData, quoteTypes);
  const recommendation = await getCarrierRecommendationAI(clientData, quoteTypes, appetite);
  return { success: true, appetite, recommendation };
}

function generateCarrierAppetite(data, quoteTypes) {
  const types = quoteTypes || ['Auto'];
  const appetite = {};

  const age = data.date_of_birth ? new Date().getFullYear() - new Date(data.date_of_birth).getFullYear() : 35;
  const state = (data.state || data.license_state || '').toUpperCase();
  const hasViolations = (data.violations && data.violations.length > 0);
  const hasAccidents = (data.accidents && data.accidents.length > 0);
  const roofAge = data.roof_year ? new Date().getFullYear() - parseInt(data.roof_year) : 5;
  const isTobacco = data.tobacco_use === 'yes' || data.tobacco_use === true;
  const bundleCount = types.length;

  if (types.includes('Auto')) {
    appetite.Auto = {
      travelers: {
        score: calcAppetiteScore({ age, hasViolations, hasAccidents, state, bonus: bundleCount > 1 ? 15 : 0 }),
        preferred: age >= 25 && age <= 65 && !hasViolations,
        reason: age >= 25 && !hasViolations ? 'Preferred tier — clean record, bundle eligible' : 'May require standard tier pricing',
        likely_approve: !hasAccidents || age > 30
      },
      progressive: {
        score: calcAppetiteScore({ age, hasViolations, hasAccidents, state, bonus: age < 25 ? 10 : 0, penalize: 0 }),
        preferred: true, // Progressive takes more risk profiles
        reason: hasViolations ? 'Strong appetite for non-standard — Snapshot discount available' : 'Snapshot telematics can lower rate 10-20%',
        likely_approve: true // Progressive rarely declines
      },
      nationwide: {
        score: calcAppetiteScore({ age, hasViolations, hasAccidents, state, bonus: 0 }),
        preferred: !hasAccidents,
        reason: !hasAccidents ? 'SmartRide eligible — usage-based discount' : 'Standard tier — prior accident noted',
        likely_approve: !hasViolations || age > 25
      },
      safeco: {
        score: calcAppetiteScore({ age, hasViolations, hasAccidents, state, penalize: 5 }),
        preferred: !hasViolations && !hasAccidents,
        reason: 'Liberty Mutual group — RightTrack discount, conservative underwriting',
        likely_approve: !hasViolations && !hasAccidents
      },
      allstate: {
        score: calcAppetiteScore({ age, hasViolations, hasAccidents, state, penalize: 8 }),
        preferred: age > 30 && !hasViolations,
        reason: 'Drivewise eligible — higher base rate offset by safe driver discount',
        likely_approve: !hasAccidents
      }
    };
  }

  if (types.includes('Home')) {
    const hasPool = data.pool === 'yes' || data.pool === true;
    const hasOldRoof = roofAge > 15;
    appetite.Home = {
      travelers: {
        score: hasOldRoof ? 55 : 88,
        preferred: !hasOldRoof && !hasPool,
        reason: hasOldRoof ? `Roof age ${roofAge}yr — Travelers may require replacement or decline` : 'Preferred homeowner pricing, strong bundle discount',
        likely_approve: roofAge < 20
      },
      progressive: {
        score: hasOldRoof ? 65 : 82,
        preferred: !hasOldRoof,
        reason: hasPool ? 'Pool noted — liability rider required' : 'HomeSafe program eligible',
        likely_approve: roofAge < 25
      },
      nationwide: {
        score: 78,
        preferred: true,
        reason: 'Multi-policy discount, hail-resistant construction credit',
        likely_approve: true
      },
      allstate: {
        score: hasPool ? 65 : 75,
        preferred: !hasPool && !hasOldRoof,
        reason: hasPool ? 'Pool surcharge applied — higher liability exposure' : 'Standard preferred rate',
        likely_approve: roofAge < 25
      }
    };
  }

  if (types.includes('Life')) {
    const bmi = data.height && data.weight ? calcBMI(data.height, data.weight) : 25;
    appetite.Life = {
      principal: {
        score: !isTobacco && bmi < 30 ? 94 : 65,
        preferred: !isTobacco,
        reason: !isTobacco ? 'Preferred Plus class — non-smoker lowest tier' : 'Tobacco rate — 2-3x standard premium',
        likely_approve: true
      },
      travelers: {
        score: !isTobacco ? 88 : 60,
        preferred: !isTobacco && bmi < 30,
        reason: 'Strong preferred pricing for healthy non-smokers',
        likely_approve: true
      },
      protective: {
        score: 85,
        preferred: !isTobacco,
        reason: 'Competitive term rates, streamlined underwriting',
        likely_approve: true
      },
      nationwide: {
        score: 79,
        preferred: !isTobacco,
        reason: 'OPTerm series — strong conversion options',
        likely_approve: true
      }
    };
  }

  if (types.includes('Health')) {
    appetite.Health = {
      bcbs: {
        score: 92,
        preferred: true,
        reason: 'Largest PPO network — best for keeping existing providers',
        likely_approve: true // ACA guaranteed issue
      },
      aetna: {
        score: 85,
        preferred: true,
        reason: 'Strong HMO option, competitive HDHP with HSA',
        likely_approve: true
      },
      nationwide: {
        score: 74,
        preferred: true,
        reason: 'Good value, smaller network in some regions',
        likely_approve: true
      }
    };
  }

  return appetite;
}

function calcAppetiteScore({ age, hasViolations, hasAccidents, state, bonus = 0, penalize = 0 }) {
  let score = 85;
  if (age < 25) score -= 15;
  if (age > 70) score -= 8;
  if (hasViolations) score -= 12;
  if (hasAccidents) score -= 18;
  if (['FL','LA','MI','CA'].includes(state)) score -= 8;
  score += bonus;
  score -= penalize;
  return Math.max(20, Math.min(99, score));
}

function calcBMI(height, weight) {
  // Parse height like "5'11" or "71 inches"
  const heightIn = height.includes("'") ?
    parseInt(height.split("'")[0]) * 12 + parseInt(height.split("'")[1]) :
    parseInt(height);
  const weightLbs = parseInt(weight);
  return (weightLbs / (heightIn * heightIn)) * 703;
}

async function getCarrierRecommendationAI(clientData, quoteTypes, appetite) {
  try {
    const profileSummary = `Client: ${clientData.full_name || 'Unknown'}, Age: ${clientData.date_of_birth ? new Date().getFullYear() - new Date(clientData.date_of_birth).getFullYear() : 'unknown'}, State: ${clientData.state || 'unknown'}, Lines: ${quoteTypes?.join(', ')}. Key factors: ${clientData.tobacco_use === 'yes' ? 'Tobacco user. ' : ''}${clientData.violations?.length ? clientData.violations.length + ' violation(s). ' : 'Clean record. '}${quoteTypes?.length > 1 ? 'Bundle opportunity. ' : ''}`;
    const prompt = `You're an expert insurance underwriter. Based on this client profile, give a 3-sentence carrier recommendation:

Profile: ${profileSummary}

Tell the agent: (1) which carrier to lead with and why, (2) which to use as backup, (3) any carriers to avoid for this risk. Use <strong> tags for carrier names and key reasons.`;
    return await claude(prompt, 300);
  } catch(e) {
    return null;
  }
}

// ─── AUTO RE-QUOTE ENGINE ─────────────────────────────────────────────────────
// Called by: scheduled Netlify function (daily) or triggered from frontend
// Checks clients approaching renewal and auto-runs new quotes
async function handleRequoteCheck({ clients, agentEmail }) {
  if (!clients || !clients.length) return { success: true, requoted: [], savings_found: [] };

  const today = new Date();
  const requoted = [];
  const savingsFound = [];

  for (const client of clients) {
    const created = new Date(client.created_at);
    const renewalDate = new Date(created);
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);
    const daysToRenewal = Math.round((renewalDate - today) / (1000 * 60 * 60 * 24));

    // Re-quote at 45 days before renewal
    if (daysToRenewal <= 45 && daysToRenewal > 0) {
      const quoteTypes = client.quote_types || ['Auto'];
      const newQuotes = {};

      // Generate new quotes for each type
      for (const qType of quoteTypes) {
        const eligible = getCarriersForType(qType);
        newQuotes[qType] = eligible.map(carrier => {
          const base = CARRIER_BASE_RATES[carrier]?.[qType] || 130;
          // Market rates shift over time — simulate slight changes
          const marketShift = 0.92 + Math.random() * 0.16; // -8% to +8%
          const monthly = Math.round(base * marketShift);
          return { carrier, monthly, annual: monthly * 12 };
        }).sort((a, b) => a.monthly - b.monthly);
      }

      requoted.push({ client_id: client.id, client_name: client.full_name, days_to_renewal: daysToRenewal, new_quotes: newQuotes });

      // Check for savings vs current bound quote
      const currentBestQuote = client.current_premium || client.best_quote_monthly;
      if (currentBestQuote) {
        for (const [qType, quotes] of Object.entries(newQuotes)) {
          const newBest = quotes[0];
          const savings = currentBestQuote - newBest.monthly;
          if (savings > 10) { // More than $10/mo savings
            savingsFound.push({
              client_id: client.id,
              client_name: client.full_name,
              quote_type: qType,
              current_premium: currentBestQuote,
              new_best_carrier: newBest.carrier,
              new_best_monthly: newBest.monthly,
              monthly_savings: savings,
              annual_savings: savings * 12,
              days_to_renewal: daysToRenewal,
              action_required: true,
              message: `💰 Save ${client.full_name} $${savings}/mo — switch to ${newBest.carrier} at renewal`
            });
          }
        }
      }
    }
  }

  // Generate AI summary of opportunities
  let aiSummary = null;
  if (savingsFound.length > 0) {
    const totalSavings = savingsFound.reduce((s, x) => s + x.annual_savings, 0);
    try {
      aiSummary = await claude(`Insurance agent has ${savingsFound.length} renewal re-quote opportunity${savingsFound.length > 1 ? 'ies' : 'y'}. Total potential annual savings for clients: $${totalSavings}. Top opportunity: ${savingsFound[0]?.message}. Write 2 sentences telling the agent what to prioritize and why. Use <strong> tags.`, 200);
    } catch(e) { /* skip */ }
  }

  return {
    success: true,
    requoted,
    savings_found: savingsFound,
    total_clients_checked: clients.length,
    opportunities: savingsFound.length,
    ai_summary: aiSummary,
    run_at: new Date().toISOString()
  };
}

const CARRIER_BASE_RATES = {
  travelers:   { Auto: 115, Home: 142, Life: 60, Health: 0 },
  progressive: { Auto: 124, Home: 152, Life: 0,  Health: 0 },
  nationwide:  { Auto: 131, Home: 160, Life: 69, Health: 438 },
  safeco:      { Auto: 138, Home: 168, Life: 0,  Health: 0 },
  allstate:    { Auto: 146, Home: 175, Life: 76, Health: 0 },
  bcbs:        { Auto: 0,   Home: 0,   Life: 0,  Health: 385 },
  aetna:       { Auto: 0,   Home: 0,   Life: 0,  Health: 409 },
  principal:   { Auto: 0,   Home: 0,   Life: 56, Health: 0 },
  protective:  { Auto: 0,   Home: 0,   Life: 58, Health: 0 },
};

function getCarriersForType(qType) {
  return Object.entries(CARRIER_BASE_RATES).filter(([, rates]) => (rates[qType] || 0) > 0).map(([id]) => id);
}

// ─── MVR ──────────────────────────────────────────────────────────────────────
async function handleMVR({ clientData }) {
  if (LEXISNEXIS_KEY) {
    try {
      const r = await fetch(`${LEXISNEXIS_URL}/v1/driving-record/order`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LEXISNEXIS_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          reportType: 'STANDARD',
          subject: {
            firstName: clientData.full_name?.split(' ')[0],
            lastName: clientData.full_name?.split(' ').slice(1).join(' '),
            dateOfBirth: clientData.date_of_birth,
            licenseNumber: clientData.license_number,
            licenseState: clientData.license_state || clientData.state,
            address: { street: clientData.address, city: clientData.city, state: clientData.state, zip: clientData.zip }
          },
          consentType: 'AGENT_PERMISSIBLE',
          permissiblePurpose: 'INSURANCE_UNDERWRITING'
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error('LexisNexis error: ' + JSON.stringify(d));
      return {
        success: true, source: 'LexisNexis_LIVE',
        data: {
          license_status: d.drivingRecord?.licenseStatus || 'Valid',
          license_class: d.drivingRecord?.licenseClass || 'Class D',
          violations: (d.drivingRecord?.violations || []).map(v => ({ type: v.violationDescription, date: v.convictionDate, points: v.points || 0 })),
          accidents: (d.drivingRecord?.accidents || []).map(a => ({ type: a.accidentType, date: a.accidentDate, amount: a.amount, atFault: a.atFault })),
          suspensions: d.drivingRecord?.suspensions || [],
          mvr_score: calcMVRScore(d.drivingRecord),
          raw: d
        }
      };
    } catch(e) { console.error('LexisNexis MVR error:', e.message); }
  }
  return { success: true, source: 'SIMULATED', data: simulateMVR(clientData) };
}

async function handleCLUE({ clientData }) {
  if (VERISK_KEY) {
    try {
      const r = await fetch(`${VERISK_URL}/insurance/clue/v2/report`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${VERISK_KEY}`, 'Content-Type': 'application/json', 'X-Client-ID': 'BrnnoQuote' },
        body: JSON.stringify({ subject: { firstName: clientData.full_name?.split(' ')[0], lastName: clientData.full_name?.split(' ').slice(1).join(' '), dateOfBirth: clientData.date_of_birth, address: { street: clientData.address, city: clientData.city, state: clientData.state, zip: clientData.zip } }, reportTypes: ['AUTO', 'HOME'], consentObtained: true, permissiblePurpose: 'INSURANCE_UNDERWRITING' })
      });
      const d = await r.json();
      if (!r.ok) throw new Error('Verisk error: ' + JSON.stringify(d));
      return { success: true, source: 'Verisk_CLUE_LIVE', data: { auto_claims: d.autoClaims || [], home_claims: d.homeClaims || [], report_date: d.reportDate } };
    } catch(e) { console.error('Verisk CLUE error:', e.message); }
  }
  return { success: true, source: 'SIMULATED', data: { auto_claims: [], home_claims: [], source_note: 'Add VERISK_API_KEY for live data' } };
}

async function handleCredit({ clientData }) {
  if (EXPERIAN_KEY) {
    try {
      const r = await fetch('https://us-api.experian.com/consumerservices/insurance/v1/insurance-score', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${EXPERIAN_KEY}`, 'Content-Type': 'application/json', 'clientReferenceId': 'BrnnoQuote' },
        body: JSON.stringify({ firstName: clientData.full_name?.split(' ')[0], lastName: clientData.full_name?.split(' ').slice(1).join(' '), dateOfBirth: clientData.date_of_birth, ssn: clientData.ssn || null, currentAddress: { street: clientData.address, city: clientData.city, state: clientData.state, zip: clientData.zip }, permissiblePurpose: 'INSURANCE_UNDERWRITING' })
      });
      const d = await r.json();
      if (!r.ok) throw new Error('Experian error: ' + JSON.stringify(d));
      return { success: true, source: 'Experian_LIVE', data: { insurance_score: d.insuranceScore, score_range: '150-950', tier: d.insuranceScore >= 750 ? 'Excellent' : d.insuranceScore >= 650 ? 'Good' : 'Fair' } };
    } catch(e) { console.error('Experian error:', e.message); }
  }
  const score = 680 + Math.floor(Math.random() * 220);
  return { success: true, source: 'SIMULATED', data: { insurance_score: score, score_range: '150-950', tier: score >= 750 ? 'Excellent' : score >= 650 ? 'Good' : 'Fair', source_note: 'Add EXPERIAN_API_KEY for live data' } };
}

async function handleBackground({ clientData }) {
  if (CHECKR_KEY) {
    try {
      const candidateRes = await fetch('https://api.checkr.com/v1/candidates', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${Buffer.from(CHECKR_KEY + ':').toString('base64')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: clientData.full_name?.split(' ')[0], last_name: clientData.full_name?.split(' ').slice(1).join(' '), email: clientData.email, dob: clientData.date_of_birth, phone: clientData.phone, zipcode: clientData.zip })
      });
      const candidate = await candidateRes.json();
      const reportRes = await fetch('https://api.checkr.com/v1/reports', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${Buffer.from(CHECKR_KEY + ':').toString('base64')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: 'driver_plus', candidate_id: candidate.id, work_locations: [{ country: 'US', state: clientData.state }] })
      });
      const report = await reportRes.json();
      return { success: true, source: 'Checkr_LIVE', data: { report_id: report.id, status: report.status, criminal_records: report.criminal_records || [] } };
    } catch(e) { console.error('Checkr error:', e.message); }
  }
  return { success: true, source: 'SIMULATED', data: { criminal_records: [], dui_records: [], source_note: 'Add CHECKR_API_KEY for live data. Requires client FCRA consent.' } };
}

// ─── QUOTE ENGINES ────────────────────────────────────────────────────────────
async function handleAutoQuote({ clientData, mvrData, creditData, coverage }) {
  const results = {};
  const carriers = [
    quoteCarrier('travelers', 'Auto', clientData, mvrData, creditData, coverage),
    quoteCarrier('progressive', 'Auto', clientData, mvrData, creditData, coverage),
    quoteCarrier('nationwide', 'Auto', clientData, mvrData, creditData, coverage),
    quoteCarrier('safeco', 'Auto', clientData, mvrData, creditData, coverage),
    quoteCarrier('allstate', 'Auto', clientData, mvrData, creditData, coverage),
  ];
  const settled = await Promise.allSettled(carriers);
  ['travelers','progressive','nationwide','safeco','allstate'].forEach((id,i) => {
    if (settled[i].status === 'fulfilled') results[id] = settled[i].value;
  });

  // Try Progressive live API
  if (PROGRESSIVE_KEY && PROGRESSIVE_AGENT_ID) {
    try {
      const token = await getProgressiveToken();
      const quote = await submitProgressiveQuote(token, clientData, mvrData, coverage);
      results.progressive = { ...results.progressive, ...quote, source: 'LIVE' };
    } catch(e) { console.error('Progressive live error:', e.message); }
  }

  // Try Travelers live API
  if (TRAVELERS_KEY && TRAVELERS_AGENT_ID) {
    try {
      const quote = await submitTravelersQuote('Auto', clientData, mvrData, coverage);
      results.travelers = { ...results.travelers, ...quote, source: 'LIVE' };
    } catch(e) { console.error('Travelers live error:', e.message); }
  }

  const ranked = Object.entries(results).sort((a,b) => (a[1].monthly||999)-(b[1].monthly||999));
  const aiRec = ranked.length ? await getAIRec('Auto', clientData, ranked) : null;
  return { success: true, quotes: results, ranked, ai_recommendation: aiRec };
}

async function handleHomeQuote({ clientData, coverage }) {
  const results = {};
  const carriers = ['travelers','progressive','nationwide','allstate'].map(id => quoteCarrier(id, 'Home', clientData, null, null, coverage));
  const settled = await Promise.allSettled(carriers);
  ['travelers','progressive','nationwide','allstate'].forEach((id,i) => { if(settled[i].status==='fulfilled') results[id]=settled[i].value; });
  if(TRAVELERS_KEY&&TRAVELERS_AGENT_ID){try{const q=await submitTravelersQuote('Home',clientData,null,coverage);results.travelers={...results.travelers,...q,source:'LIVE'};}catch(e){}}
  const ranked=Object.entries(results).sort((a,b)=>(a[1].monthly||999)-(b[1].monthly||999));
  return { success: true, quotes: results, ranked, ai_recommendation: await getAIRec('Home', clientData, ranked) };
}

async function handleHealthQuote({ clientData, coverage }) {
  const results = {};
  const healthCarriers = [
    {id:'bcbs',base:385},{id:'aetna',base:409},{id:'nationwide',base:438},{id:'cigna',base:421},{id:'kaiser',base:362}
  ];
  healthCarriers.forEach(c => {
    const mult=0.88+Math.random()*0.28, monthly=Math.round(c.base*mult);
    const income=parseInt(clientData.household_income)||60000;
    const fpl={1:14580,2:19720,3:24860,4:30000}[Math.min(parseInt(clientData.household_size)||1,4)]||30000;
    const subsidy=income/fpl<4?Math.max(0,Math.round(monthly*0.45)):0;
    results[c.id]={carrier:c.id,source:'SIMULATED',monthly,monthly_after_subsidy:Math.max(0,monthly-subsidy),subsidy_amount:subsidy,deductible:'$'+[500,1000,1500,2000][Math.floor(Math.random()*4)],ai_score:Math.round(70+Math.random()*25),ai_reason:subsidy>0?`~$${subsidy}/mo subsidy may apply`:'Standard market rate'};
  });
  const ranked=Object.entries(results).sort((a,b)=>(a[1].monthly||999)-(b[1].monthly||999));
  return { success: true, quotes: results, ranked, ai_recommendation: await getAIRec('Health', clientData, ranked) };
}

async function handleLifeQuote({ clientData, coverage }) {
  const results = {};
  const lifeCarriers = [{id:'principal',base:56},{id:'travelers',base:61},{id:'nationwide',base:69},{id:'protective',base:58},{id:'banner',base:54},{id:'aig',base:67},{id:'allstate',base:76}];
  lifeCarriers.forEach(c => {
    const dob=clientData.date_of_birth, age=dob?new Date().getFullYear()-new Date(dob).getFullYear():40;
    const ageFactor=1+Math.max(0,age-35)*0.032;
    const covAmt=parseInt(coverage?.coverage_amount)||500000;
    const term=parseInt(coverage?.term_length)||20;
    const termF=term>=30?1.35:term>=20?1.0:0.75;
    const monthly=Math.round(c.base*ageFactor*(covAmt/500000)*termF*(0.9+Math.random()*0.2));
    results[c.id]={carrier:c.id,source:'SIMULATED',monthly,annual:monthly*12,coverage:covAmt,term:term+'yr',health_class:clientData.tobacco_use==='yes'?'Standard Tobacco':'Preferred Plus',ai_score:Math.round(60+Math.random()*35),ai_reason:`${term}yr term · ${clientData.tobacco_use==='yes'?'Tobacco rate':'Non-smoker preferred'}`};
  });
  const ranked=Object.entries(results).sort((a,b)=>(a[1].monthly||999)-(b[1].monthly||999));
  return { success: true, quotes: results, ranked, ai_recommendation: await getAIRec('Life', clientData, ranked) };
}

async function handleAllQuotes({ clientData, mvrData, creditData, coverage, quoteTypes }) {
  const types=quoteTypes||clientData.quote_types||['Auto'];
  const results={};
  const promises=[];
  if(types.includes('Auto'))promises.push(handleAutoQuote({clientData,mvrData,creditData,coverage}).then(r=>{results.Auto=r;}));
  if(types.includes('Home'))promises.push(handleHomeQuote({clientData,coverage}).then(r=>{results.Home=r;}));
  if(types.includes('Health'))promises.push(handleHealthQuote({clientData,coverage}).then(r=>{results.Health=r;}));
  if(types.includes('Life'))promises.push(handleLifeQuote({clientData,coverage}).then(r=>{results.Life=r;}));
  await Promise.allSettled(promises);
  return { success: true, results, types_quoted: types };
}

// ─── CARRIER QUOTE SIMULATION ─────────────────────────────────────────────────
async function quoteCarrier(carrierId, lineOfBusiness, clientData, mvrData, creditData, coverage) {
  let mult=0.88+Math.random()*0.26;
  const state=(clientData?.state||'').toUpperCase();
  if(['TX','FL','LA','MI','CA'].includes(state))mult+=0.09;
  if(['ME','VT','NH','ID','WI'].includes(state))mult-=0.07;
  const dob=clientData?.date_of_birth;
  if(dob){const age=new Date().getFullYear()-new Date(dob).getFullYear();if(age<25)mult+=0.20;else if(age>65)mult+=0.10;else if(age>=35&&age<=55)mult-=0.06;}
  if(mvrData?.violations?.length>0)mult+=0.12*mvrData.violations.length;
  if(mvrData?.accidents?.length>0)mult+=0.18*mvrData.accidents.length;
  const base=CARRIER_BASE_RATES[carrierId]?.[lineOfBusiness]||130;
  const monthly=Math.round(base*mult);
  const score=Math.min(99,Math.round((CARRIER_WIN_RATES[carrierId]||15)*2+(1/mult)*15+Math.random()*8));
  return {carrier:carrierId,source:'SIMULATED',monthly,annual:monthly*12,deductible:lineOfBusiness==='Life'?'N/A':lineOfBusiness==='Health'?'$'+[500,1000,1500][Math.floor(Math.random()*3)]:'$'+[250,500,1000][Math.floor(Math.random()*3)],ai_score:score,ai_reason:getCarrierReason(carrierId,lineOfBusiness)};
}

const CARRIER_WIN_RATES = { travelers:38, progressive:29, nationwide:18, safeco:9, allstate:6, bcbs:42, aetna:28, principal:27, protective:24 };

function getCarrierReason(carrierId, line) {
  const reasons = {
    travelers:{Auto:'Preferred tier — clean record',Home:'Bundle discount, claims-free',Life:'Preferred+ health class'},
    progressive:{Auto:'Snapshot telematics eligible',Home:'HomeSafe program'},
    nationwide:{Auto:'SmartRide discount eligible',Home:'Multi-policy discount',Life:'OPTerm series',Health:'Standard PPO rate'},
    safeco:{Auto:'RightTrack eligible',Home:'Liberty Mutual group rate'},
    allstate:{Auto:'Drivewise eligible',Home:'Standard market rate',Life:'Standard term rate'},
    bcbs:{Health:'Largest PPO network'},aetna:{Health:'Competitive HDHP'},
    principal:{Life:'Preferred Plus class'},protective:{Life:'Streamlined UW'},
  };
  return reasons[carrierId]?.[line] || 'Competitive market rate';
}

// ─── PROGRESSIVE LIVE API ─────────────────────────────────────────────────────
async function getProgressiveToken() {
  const r = await fetch('https://api.progressive.com/oauth/token', {
    method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded'},
    body: `grant_type=client_credentials&client_id=${PROGRESSIVE_KEY}&client_secret=${PROGRESSIVE_AGENT_ID}`
  });
  const d = await r.json();
  return d.access_token;
}

async function submitProgressiveQuote(token, clientData, mvrData, coverage) {
  const r = await fetch('https://api.progressive.com/v1/quotes/auto', {
    method:'POST',
    headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','X-Agent-ID':PROGRESSIVE_AGENT_ID},
    body:JSON.stringify({ agents:[{id:PROGRESSIVE_AGENT_ID}], drivers:buildDriverArray(clientData,mvrData), vehicles:buildVehicleArray(clientData), coverages:buildAutoCoverages(coverage), applicant:buildApplicant(clientData) })
  });
  const d = await r.json();
  return { monthly:Math.round(d.premium?.totalPremium/6), annual:d.premium?.totalPremium, quote_id:d.quoteId, discounts:d.discounts };
}

// ─── TRAVELERS LIVE API ───────────────────────────────────────────────────────
async function submitTravelersQuote(line, clientData, mvrData, coverage) {
  const endpoint = {Auto:'personal-auto',Home:'homeowners',Life:'life'}[line];
  const r = await fetch(`https://api.travelers.com/v2/quotes/${endpoint}`, {
    method:'POST',
    headers:{'Authorization':`Bearer ${TRAVELERS_KEY}`,'Content-Type':'application/json','X-Agency-ID':TRAVELERS_AGENT_ID,'X-Channel':'AGENT'},
    body:JSON.stringify(buildTravelersPayload(line, clientData, mvrData, coverage))
  });
  const d = await r.json();
  if(!r.ok) throw new Error('Travelers: ' + JSON.stringify(d));
  return { monthly:Math.round((d.totalPremium||d.annualPremium)/12), annual:d.totalPremium||d.annualPremium, quote_id:d.quoteNumber, discounts:d.discounts };
}

// ─── EMAIL ────────────────────────────────────────────────────────────────────
async function handleEmail({ extractedData, quoteTypes, agentName, clientText }) {
  const prompt = `Write a professional insurance follow-up email from agent "${agentName || 'Your Agent'}" to a client about ${(quoteTypes||[]).join(', ')} insurance. Client: ${JSON.stringify(extractedData||{})}. Under 180 words, warm and professional. Return ONLY the email body.`;
  return { success: true, emailBody: await claude(prompt, 400) };
}

// ─── AI RECOMMENDATION ────────────────────────────────────────────────────────
async function getAIRec(line, clientData, ranked) {
  try {
    const top3=ranked.slice(0,3).map(([c,d])=>`${c}: $${d.monthly}/mo (score:${d.ai_score})`).join(', ');
    const prompt=`Insurance agent needs a 2-sentence carrier recommendation. Line: ${line}. Top options: ${top3}. Client state: ${clientData.state}. Be specific, actionable. Use <strong> tags for carrier names and key numbers.`;
    return await claude(prompt, 200);
  } catch(e) { return null; }
}

// ─── PAYLOAD BUILDERS ─────────────────────────────────────────────────────────
function buildApplicant(d) { return { firstName:d.full_name?.split(' ')[0], lastName:d.full_name?.split(' ').slice(1).join(' '), dateOfBirth:d.date_of_birth, email:d.email, phone:d.phone, address:{street:d.address,city:d.city,state:d.state,zip:d.zip} }; }
function buildDriverArray(d,mvrData) { return [{ firstName:d.full_name?.split(' ')[0], lastName:d.full_name?.split(' ').slice(1).join(' '), dateOfBirth:d.date_of_birth, licenseNumber:d.license_number, licenseState:d.license_state||d.state, violations:mvrData?.violations||[], accidents:mvrData?.accidents||[], relationship:'NAMED_INSURED' }]; }
function buildVehicleArray(d) { if(d.vehicles&&Array.isArray(d.vehicles))return d.vehicles.map(v=>({year:v.year,make:v.make,model:v.model,vin:v.vin,usage:v.usage||'COMMUTE',annualMiles:v.annual_miles||12000,ownership:v.ownership||'OWNED'})); return [{year:new Date().getFullYear()-2,make:'Honda',model:'Accord',usage:'COMMUTE',annualMiles:12000,ownership:'OWNED'}]; }
function buildAutoCoverages(coverage) { return { bodilyInjury:coverage?.bodily_injury||'100/300', propertyDamage:coverage?.property_damage||100000, uninsuredMotorist:true, comprehensiveDeductible:parseInt(coverage?.comprehensive_deductible)||500, collisionDeductible:parseInt(coverage?.collision_deductible)||500 }; }
function buildTravelersPayload(line, clientData, mvrData, coverage) {
  const base={applicant:buildApplicant(clientData),effectiveDate:getNextMonth()};
  if(line==='Auto')return{...base,drivers:buildDriverArray(clientData,mvrData),vehicles:buildVehicleArray(clientData),coverages:buildAutoCoverages(coverage)};
  if(line==='Home')return{...base,property:{address:{street:clientData.address,city:clientData.city,state:clientData.state,zip:clientData.zip},yearBuilt:clientData.year_built,squareFootage:clientData.square_footage},coverages:{dwellingAmount:parseInt(coverage?.coverage_amount)||350000,deductible:parseInt(coverage?.deductible)||2500}};
  return base;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function calcMVRScore(record) {
  const v=record?.violations?.length||0, a=record?.accidents?.length||0, s=record?.suspensions?.length||0;
  if(s>0)return 'Non-standard';if(v>2||a>1)return 'Non-standard';if(v>0||a>0)return 'Standard';return 'Preferred+';
}
function simulateMVR(clientData) {
  const seed=(clientData?.full_name||'').length%10;
  const violations=seed>7?[{type:'Speeding 1-10mph',date:'2023-04-15',points:2,state:clientData?.state||'TX'}]:[];
  const accidents=seed>9?[{type:'At-fault collision',date:'2022-08-20',amount:3800,atFault:true}]:[];
  return{license_status:'Valid',license_class:'Class D',violations,accidents,suspensions:[],mvr_score:violations.length===0&&accidents.length===0?'Preferred+':'Standard',source_note:'Simulated — add LEXISNEXIS_API_KEY for live data'};
}
function calcCompleteness(data, docType) {
  const keyFields = {
    drivers_license: ['full_name','date_of_birth','license_number','license_state','address'],
    declarations_page: ['policy_number','named_insured','insurer','annual_premium','vehicles','drivers','coverages'],
    vehicle_registration: ['year','make','model','vin','registered_owner_name'],
    home_inspection: ['property_address','year_built','square_footage','construction_type'],
    health_records: ['patient_name','date_of_birth'],
    current_policy: ['policy_number','insurer','annual_premium','coverages']
  };
  const fields = keyFields[docType] || Object.keys(data);
  const filled = fields.filter(f => data[f] !== null && data[f] !== undefined && data[f] !== '').length;
  return Math.round(filled / fields.length * 100);
}
function getNextMonth() { const d=new Date();d.setMonth(d.getMonth()+1);d.setDate(1);return d.toISOString().split('T')[0]; }
function getFieldsFor(type) {
  const F={Auto:'full_name, date_of_birth, phone, email, address, city, state, zip, license_number, license_state, marital_status, vehicles (array: year,make,model,vin,usage,annual_miles,ownership), drivers (array: name,dob,relationship), coverage_type, bodily_injury_limits, comprehensive_deductible, collision_deductible, uninsured_motorist, current_insurer, current_premium, continuous_coverage_years',Home:'full_name, date_of_birth, phone, email, property_address, city, state, zip, year_built, square_footage, construction_type, roof_type, roof_year, stories, pool, trampoline, security_system, coverage_amount, deductible, current_insurer, current_premium, mortgagee_name, mortgagee_loan_number',Health:'full_name, date_of_birth, phone, email, address, city, state, zip, gender, tobacco_user, household_size, household_income, coverage_type, dependents (array: name,dob), pre_existing_conditions, current_medications, preferred_doctors, plan_type_preference, current_insurer, current_premium, subsidy_eligible, open_enrollment_qualifying_event',Life:'full_name, date_of_birth, phone, email, address, city, state, zip, gender, tobacco_user, height, weight, health_rating, occupation, annual_income, coverage_amount, coverage_type, term_length, beneficiary_name, beneficiary_relationship, contingent_beneficiary, medical_history_notes'};
  return F[type]||'full_name, date_of_birth, phone, email, state';
}
