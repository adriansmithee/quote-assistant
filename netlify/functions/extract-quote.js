exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { clientText, quoteType, action } = JSON.parse(event.body);

  const FIELDS = {
    home: `full_name, date_of_birth (YYYY-MM-DD), phone, email, property_address, city, state, zip, year_built, square_footage, construction_type, roof_type, roof_year, stories, bedrooms, bathrooms, garage, pool, trampoline, security_system, coverage_amount, deductible, current_insurer, current_premium, effective_date, prior_claims, mortgagee_name, mortgagee_loan_number`,
    auto: `full_name, date_of_birth, phone, email, address, city, state, zip, license_number, license_state, marital_status, vehicles (array), drivers (array), coverage_type, bodily_injury_limits, property_damage_limit, uninsured_motorist, comprehensive_deductible, collision_deductible, current_insurer, current_premium, continuous_coverage_years, effective_date`,
    health: `full_name, date_of_birth, phone, email, address, city, state, zip, gender, tobacco_user, household_size, household_income, coverage_type, dependents (array), pre_existing_conditions, current_medications, preferred_doctors, preferred_hospitals, plan_type_preference, current_insurer, current_premium, subsidy_eligible, effective_date, open_enrollment_qualifying_event`,
    life: `full_name, date_of_birth, phone, email, address, city, state, zip, gender, tobacco_user, height, weight, health_rating, occupation, annual_income, coverage_amount, coverage_type, term_length, beneficiary_name, beneficiary_relationship, contingent_beneficiary, existing_life_insurance, reason_for_coverage, current_insurer, current_premium, effective_date, medical_history_notes`
  };

  if (action === 'email') {
    const { extractedData, quoteTypes, agentName } = JSON.parse(event.body);
    const prompt = `You are an expert insurance agent assistant. Write a warm professional follow-up email. Agent: ${agentName || 'Your Agent'}. Quote types: ${quoteTypes.join(', ')}. Client data: ${JSON.stringify(extractedData)}. Write under 200 words, warm tone, no specific premium numbers. Return ONLY the email body.`;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: prompt }] })
    });
    const data = await response.json();
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, emailBody: data.content?.[0]?.text || '' }) };
  }

  const types = Array.isArray(quoteType) ? quoteType : [quoteType];
  const fieldsList = types.map(t => `"${t}": { ${FIELDS[t]} }`).join(',\n');
  const prompt = `You are an expert insurance quoting assistant. Extract ALL relevant information from the client notes below. Return ONLY a valid JSON object - no markdown, no explanation. Structure: { ${fieldsList} }. Use null for missing fields. Dates in YYYY-MM-DD. Dollar amounts as numbers.\nClient notes:\n${clientText}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 3000, messages: [{ role: "user", content: prompt }] })
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, data: parsed }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
