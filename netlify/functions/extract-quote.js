exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const body = JSON.parse(event.body);
  const { action, message, context, clientText, quoteType, extractedData, quoteTypes, agentName } = body;

  const callClaude = async (prompt, maxTokens=1000) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
    });
    const data = await res.json();
    return data.content?.[0]?.text || "";
  };

  try {
    if (action === "chat") {
      const prompt = `You are an expert AI assistant for independent insurance agents. You help agents find the best plans for their clients across carriers like Progressive, Travelers, Nationwide, Safeco, and Allstate.

Context: ${context || "No client selected"}
Agent question: ${message}

Give a concise, expert response in 2-4 sentences. Use HTML <strong> tags for emphasis on key numbers or recommendations. Focus on actionable advice for the agent. If asked about a specific client or carrier, give specific guidance.`;
      const reply = await callClaude(prompt, 400);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, reply }) };
    }

    if (action === "email") {
      const prompt = `You are an expert insurance agent assistant. Write a professional follow-up email to a client after an insurance consultation.

Agent name: ${agentName || "Your Agent"}
Quote types discussed: ${(quoteTypes||[]).join(", ")}
Client data: ${JSON.stringify(extractedData || {})}

Write a warm, professional email that:
1. Opens with their first name
2. Thanks them for their time
3. Summarizes the top recommendation with the price
4. Sets expectations (agent will follow up within 24hrs with final options)
5. Closes warmly

Keep it under 180 words. Do NOT make up specific premium numbers unless they are in the client data. Return ONLY the email body text.`;
      const emailBody = await callClaude(prompt, 500);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, emailBody }) };
    }

    if (action === "extract" || !action) {
      const FIELDS = {
        Auto: `full_name, date_of_birth (YYYY-MM-DD), phone, email, address, city, state, zip, license_number, license_state, marital_status, vehicles (array of: year, make, model, vin, usage, annual_miles, ownership), drivers (array of: name, dob, relationship, violations_last_5_years, accidents_last_5_years), coverage_type, bodily_injury_limits, property_damage_limit, uninsured_motorist, comprehensive_deductible, collision_deductible, current_insurer, current_premium, continuous_coverage_years, effective_date`,
        Home: `full_name, date_of_birth, phone, email, property_address, city, state, zip, year_built, square_footage, construction_type, roof_type, roof_year, stories, bedrooms, bathrooms, garage, pool, trampoline, security_system, coverage_amount, deductible, current_insurer, current_premium, mortgagee_name, mortgagee_loan_number, effective_date, prior_claims`,
        Health: `full_name, date_of_birth, phone, email, address, city, state, zip, gender, tobacco_user, household_size, household_income, coverage_type, dependents (array), pre_existing_conditions, current_medications, preferred_doctors, preferred_hospitals, plan_type_preference, current_insurer, current_premium, subsidy_eligible, effective_date, open_enrollment_qualifying_event`,
        Life: `full_name, date_of_birth, phone, email, address, city, state, zip, gender, tobacco_user, height, weight, health_rating, occupation, annual_income, coverage_amount, coverage_type, term_length, beneficiary_name, beneficiary_relationship, contingent_beneficiary, existing_life_insurance, reason_for_coverage, current_insurer, current_premium, effective_date, medical_history_notes`
      };
      const types = Array.isArray(quoteType) ? quoteType : [quoteType];
      const fieldsList = types.map(t => `"${t}": { ${FIELDS[t] || ''} }`).join(",\n");
      const prompt = `You are an expert insurance quoting assistant. Extract ALL relevant information from the client notes below.

Return ONLY a valid JSON object — no markdown, no explanation, no code fences. Just raw JSON.

Structure:
{
  ${fieldsList}
}

Rules:
- Use null for any field not mentioned
- For arrays (vehicles, drivers, dependents), return proper JSON arrays
- Dates in YYYY-MM-DD format
- Dollar amounts as numbers without $ or commas
- Be thorough — extract anything that fits a field

Client notes:
${clientText}`;
      const text = await callClaude(prompt, 3000);
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, data: parsed }) };
    }

    return { statusCode: 400, body: JSON.stringify({ success: false, error: "Unknown action" }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
