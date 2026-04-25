// BrnnoQuote — Full API Integration Layer
// All integrations built and ready. Each has a LIVE path (real API) and SIMULATION path (until credentials added).

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
const BCBS_KEY = process.env.BCBS_API_KEY;
const AETNA_KEY = process.env.AETNA_API_KEY;
const PRINCIPAL_KEY = process.env.PRINCIPAL_API_KEY;
const COVERHOUND_KEY = process.env.COVERHOUND_API_KEY; // aggregator — covers multiple carriers

exports.handler = async (event) => {