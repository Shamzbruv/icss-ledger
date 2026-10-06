/**
 * Referral Partner Commission Agreement — a general iCreate Solutions & Services agreement for
 * anyone who refers clients to the Company (not tied to a single iCreate-owned product).
 *
 * It plugs into the Partner Contracts engine (partnerContractTemplate.js): the same
 * `partner_contracts` table, e-signature page, PDF and emails. This module only supplies what is
 * specific to the referral agreement:
 *   - the template metadata,
 *   - the per-partner commercial terms and their validation,
 *   - the legal text as a structured block list (same vocabulary as the other templates),
 *   - the acknowledgements the partner ticks, and the summary rows used in emails.
 *
 * The clause wording follows the agreement supplied by the Company verbatim. Bracketed
 * placeholders in that document ([DATE], [FULL NAME…], [ADDRESS], [7/14/30], [START DATE]) and the
 * commission figures are filled from the contract record, so each partner's copy shows exactly
 * the terms the Company chose.
 *
 * Inline emphasis uses **bold** markers; renderers turn them into real bold text.
 */

const REFERRAL_TEMPLATE_ID = 'referral-commission';
const REFERRAL_COMPANY_SLUG = 'referrals';
const REFERRAL_COMPANY_SIGNER = 'Shamar Baker';
const REFERRAL_COMPANY_POSITION = 'Owner / Authorized Representative';

const REFERRAL_DEFAULTS = Object.freeze({
  flatCommissionAmount: 2000,
  commissionThresholdAmount: 120000,
  commissionPercent: 5,
  paymentDueDays: 14,
  terminationNoticeDays: 14
});

const REFERRAL_TEMPLATE = {
  id: REFERRAL_TEMPLATE_ID,
  companySlug: REFERRAL_COMPANY_SLUG,
  kind: 'referral',
  title: 'Referral Partner Commission Agreement',
  shortTitle: 'Referral Partner',
  docLabel: 'Referral Partner Commission Agreement',
  tag: 'Referrals',
  summary: 'A general agreement for anyone who introduces clients to iCreate Solutions & Services. A flat commission on smaller projects and a percentage of larger ones, paid only once the client has paid.',
  term: 'Ongoing until ended by either party with written notice',
  scope: '',
  tail: '',
  supportsFormal: false,
  duties: [],
  roleTerms: []
};

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 5 -> "Five", 25 -> "Twenty-Five", 100 -> "One Hundred". Non-integers fall back to digits. */
function percentWords(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) return String(value);
  if (n === 0) return 'Zero';
  if (n === 100) return 'One Hundred';
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

/** 2000 -> "JMD $2,000"; 2500.5 -> "JMD $2,500.50". */
function formatJmd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'JMD $0';
  const fractional = Math.abs(n % 1) > 0;
  return `JMD $${n.toLocaleString('en-US', { minimumFractionDigits: fractional ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function percentText(value) {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function splitLines(raw) {
  return String(raw || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// -----------------------------------------------------------------------------
// Per-partner terms: validation + normalisation
// -----------------------------------------------------------------------------
function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(String(value).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Validates the commercial terms the admin enters. Returns { terms, error }.
 * `terms` is what gets stored in `custom_terms_json`.
 */
function normalizeReferralTerms(input = {}) {
  const flat = toNumber(input.flat_commission_amount);
  const threshold = toNumber(input.commission_threshold_amount);
  const percent = toNumber(input.commission_percent);

  const flatValue = flat === undefined ? REFERRAL_DEFAULTS.flatCommissionAmount : flat;
  const thresholdValue = threshold === undefined ? REFERRAL_DEFAULTS.commissionThresholdAmount : threshold;
  const percentValue = percent === undefined ? REFERRAL_DEFAULTS.commissionPercent : percent;

  if (Number.isNaN(flatValue) || flatValue < 0 || flatValue > 100000000) return { error: 'The flat commission must be a number of 0 or more (in JMD).' };
  if (Number.isNaN(thresholdValue) || thresholdValue <= 0 || thresholdValue > 10000000000) return { error: 'The project value threshold must be a number greater than 0 (in JMD).' };
  if (Number.isNaN(percentValue) || percentValue < 0 || percentValue > 100) return { error: 'The commission percentage must be a number between 0 and 100.' };

  const additional = Array.isArray(input.additional_terms)
    ? input.additional_terms.map((s) => String(s).trim()).filter(Boolean)
    : splitLines(input.additional_terms);
  if (additional.length > 30 || additional.some((line) => line.length > 1500)) {
    return { error: 'Additional terms are limited to 30 lines of up to 1,500 characters each.' };
  }

  return {
    terms: {
      flat_commission_amount: Math.round(flatValue * 100) / 100,
      commission_threshold_amount: Math.round(thresholdValue * 100) / 100,
      commission_percent: Math.round(percentValue * 100) / 100,
      additional_terms: additional
    }
  };
}

/** Flat values the template needs, from a `partner_contracts` row or a frozen snapshot. */
function buildReferralFields(contract = {}) {
  const ct = (contract.custom_terms_json && typeof contract.custom_terms_json === 'object') ? contract.custom_terms_json : {};
  const flat = toNumber(ct.flat_commission_amount);
  const threshold = toNumber(ct.commission_threshold_amount);
  const percent = toNumber(ct.commission_percent ?? contract.revenue_share_percent);
  return {
    flatCommissionAmount: Number.isFinite(flat) ? flat : REFERRAL_DEFAULTS.flatCommissionAmount,
    commissionThresholdAmount: Number.isFinite(threshold) ? threshold : REFERRAL_DEFAULTS.commissionThresholdAmount,
    commissionPercent: Number.isFinite(percent) ? percent : REFERRAL_DEFAULTS.commissionPercent,
    additionalTerms: Array.isArray(ct.additional_terms) ? ct.additional_terms.map(String).filter(Boolean) : splitLines(ct.additional_terms)
  };
}

// -----------------------------------------------------------------------------
// Acknowledgements (what the partner ticks before signing)
// -----------------------------------------------------------------------------
const REFERRAL_ACKNOWLEDGEMENTS = [
  {
    key: 'commission_ack',
    title: 'Acknowledgement of Commission Terms',
    text: (d) => `I understand that I will earn ${formatJmd(d.flatCommissionAmount)} per successfully completed referral on projects below ${formatJmd(d.commissionThresholdAmount)}, and ${percentText(d.commissionPercent)}% of the project amount actually received by the Company on projects of ${formatJmd(d.commissionThresholdAmount)} or more. I understand that commission is payable only after the referred client's payment has been received and cleared, and is not payable on unpaid, cancelled, refunded or charged-back amounts.`
  },
  {
    key: 'independent_ack',
    title: 'Acknowledgement of Independent Referral Role',
    text: (d) => `I confirm that I am an independent referral partner and not an employee, officer or authorized agent of ${d.companyName}. I have no authority to bind the Company, set or negotiate prices, make promises or guarantees, sign agreements, or collect or hold client payments on its behalf.`
  },
  {
    key: 'conduct_ack',
    title: 'Acknowledgement of Conduct, Confidentiality and Non-Circumvention',
    text: () => 'I have read and agree to the provisions on professional conduct, confidentiality, client information and data protection, and non-circumvention described in this Agreement.'
  },
  {
    key: 'signature_confirmation',
    title: 'Signature Confirmation',
    text: () => 'By checking this box, signing below, and submitting this Agreement, I confirm that the electronic signature is mine and that I intend to enter into and be bound by this Agreement.'
  }
];

// -----------------------------------------------------------------------------
// The agreement text
// -----------------------------------------------------------------------------
/**
 * @param {object} d  output of buildPartnerContractData() for a referral contract
 * @returns {Array<{type:string}>} blocks: title | h2 | h3 | p | ul | ol | field | signatures-intro
 */
function renderReferralSections(d) {
  const S = [];
  const p = (text) => S.push({ type: 'p', text });
  const h2 = (text) => S.push({ type: 'h2', text });
  const h3 = (text) => S.push({ type: 'h3', text });
  const ul = (items) => S.push({ type: 'ul', items });
  const ol = (items) => S.push({ type: 'ol', items });

  const company = d.companyName || 'iCreate Solutions & Services';
  const threshold = formatJmd(d.commissionThresholdAmount);
  const flat = formatJmd(d.flatCommissionAmount);
  const percent = percentText(d.commissionPercent);
  const paymentDays = d.paymentDueDays;
  const noticeDays = d.terminationNoticeDays;

  S.push({ type: 'title', text: 'REFERRAL PARTNER COMMISSION AGREEMENT' });

  p(`This Referral Partner Commission Agreement (“Agreement”) is made and entered into on **${d.effectiveDate}**, between:`);
  p(`**${company}**, represented by **${d.companySignerName}**, hereinafter referred to as **“the Company,”**`);
  p('and');
  p(`**${d.partnerName}**, of ${d.partnerAddress ? `**${d.partnerAddress}**` : 'the address stated in the Referral Partner’s signature details below'}, hereinafter referred to as **“the Referral Partner.”**`);
  p('Together, the Company and the Referral Partner shall be referred to as **“the Parties.”**');

  h2('1. PURPOSE OF AGREEMENT');
  p(`The purpose of this Agreement is to establish the terms under which the Referral Partner may identify, introduce, and refer prospective clients to ${company} in exchange for commission on qualifying projects successfully secured and paid for by those referred clients.`);
  p('The Referral Partner is not an employee of the Company and is engaged solely as an independent referral partner.');

  h2('2. RESPONSIBILITIES OF THE REFERRAL PARTNER');
  p('The Referral Partner agrees to:');
  ol([
    `Identify and refer legitimate prospective clients who may require the services offered by ${company}.`,
    'Where appropriate, introduce prospective clients directly to the Company.',
    "Provide accurate information when describing the Company's services.",
    'Conduct themselves professionally and honestly when representing their relationship with the Company.',
    'Refrain from making promises, guarantees, pricing commitments, contractual agreements, or representations on behalf of the Company unless expressly authorized in writing.',
    'Ensure that any prospective client referred has a genuine interest in obtaining services from the Company.',
    'Avoid misleading, fraudulent, unethical, or deceptive practices when sourcing or referring prospective clients.'
  ]);

  h2('3. SERVICES PROVIDED BY THE COMPANY');
  p(`${company} may provide services including, but not limited to:`);
  ul([
    'Software and application development',
    'Business systems and digital platforms',
    'E-commerce solutions',
    'Booking and management systems',
    'Graphic design and branding',
    'Animation and multimedia services',
    'Digital business solutions',
    'Website and web-based system development',
    'Custom technology solutions',
    'Other related professional services offered by the Company'
  ]);
  p('The Company retains full discretion regarding whether to accept or decline any referred client or project.');

  h2('4. COMMISSION STRUCTURE');
  p('The Referral Partner shall be eligible to receive commission according to the following structure:');
  h3(`Projects Below ${threshold}`);
  p(`For qualifying projects with a total contracted value of less than **${threshold}**, the Referral Partner shall receive a referral commission of:`);
  p(`**${flat} per successfully completed referral.**`);
  h3(`Projects of ${threshold} or More`);
  p(`For qualifying projects with a contracted value of **${threshold} or more**, the Referral Partner shall receive:`);
  p(`**${percentWords(d.commissionPercent)} Percent (${percent}%) of the qualifying project amount received by the Company.**`);
  p('Unless otherwise agreed in writing, commission shall be calculated based on funds actually received by the Company and shall not include amounts refunded, reversed, charged back, cancelled, or otherwise unpaid.');

  h2('5. WHEN A REFERRAL QUALIFIES');
  p('A referral qualifies for commission only when:');
  ol([
    'The Referral Partner was responsible for introducing the prospective client to the Company;',
    'The prospective client was not already an active client or active lead of the Company before the referral;',
    'The Company confirms that the referral has been attributed to the Referral Partner;',
    'A formal agreement, quotation, invoice, or project arrangement is accepted by the referred client; and',
    'The Company receives the required payment from the referred client.'
  ]);
  p('Merely providing a name, telephone number, social media profile, email address, or business contact does not automatically create an entitlement to commission unless the Company recognizes the referral as a qualifying referral.');

  h2('6. PAYMENT OF COMMISSION');
  p('Commission shall become payable only after the Company receives the applicable client payment.');
  p('Where the client pays in installments, the Company may calculate and pay commission proportionately as qualifying funds are received.');
  p('Commission shall not be payable on:');
  ul([
    'Unpaid invoices;',
    'Cancelled projects;',
    'Refunded payments;',
    'Chargebacks;',
    'Fraudulent transactions;',
    'Amounts written off;',
    'Projects that do not proceed;',
    'Leads already being actively pursued by the Company before the referral.'
  ]);
  p(`Payment of earned commission shall normally be made within **${paymentDays} business days** after the applicable client payment has cleared.`);
  p('The Referral Partner shall provide accurate payment information to facilitate payment.');

  h2('7. REFERRAL REGISTRATION');
  p("Where necessary, referrals should be submitted to the Company through the Company's approved communication channel, referral form, email, CRM system, WhatsApp contact, or other method designated by the Company.");
  p('The Company may maintain records showing the date a referral was submitted and the Referral Partner associated with the prospective client.');
  p("Where two or more persons claim the same referral, the Company's records and evidence of the original introduction shall be used to determine entitlement.");

  h2('8. PRICING AND NEGOTIATIONS');
  p('Only the Company has authority to:');
  ul([
    'Set project prices;',
    'Negotiate discounts;',
    'Issue quotations;',
    'Approve payment plans;',
    'Determine project scope;',
    'Enter contractual agreements with clients;',
    'Alter project terms.'
  ]);
  p('The Referral Partner shall not independently negotiate or modify prices on behalf of the Company without prior authorization.');

  h2('9. NO AUTHORITY TO BIND THE COMPANY');
  p(`Nothing in this Agreement gives the Referral Partner authority to enter into contracts, incur expenses, accept payments, make commitments, or create legal obligations on behalf of ${company}.`);
  p('The Referral Partner shall not represent themselves as an employee, officer, director, legal representative, or authorized agent of the Company.');

  h2('10. CLIENT PAYMENTS');
  p(`Unless specifically authorized in writing, all client payments must be made directly to ${company} through payment methods approved by the Company.`);
  p('The Referral Partner shall not collect, hold, redirect, or retain client payments on behalf of the Company.');

  h2('11. REFUNDS, DISPUTES AND CHARGEBACKS');
  p('If a client payment on which commission has already been paid is subsequently refunded, reversed, successfully disputed, or charged back, the applicable commission may:');
  ol([
    'Be deducted from future commissions payable to the Referral Partner; or',
    'Be repayable to the Company where no future commission is available for deduction.'
  ]);

  h2('12. CONFIDENTIALITY');
  p('The Referral Partner may receive confidential information relating to the Company, its clients, pricing, business strategy, proposals, operations, systems, processes, or other commercially sensitive information.');
  p('The Referral Partner agrees not to disclose, reproduce, distribute, misuse, or exploit confidential information without authorization.');
  p('This obligation shall continue after termination of this Agreement.');

  h2('13. CLIENT INFORMATION AND DATA PROTECTION');
  p('Any personal or business information obtained in connection with a referral must be handled responsibly and used only for legitimate referral and business purposes.');
  p('The Referral Partner shall not sell, misuse, publicly disclose, or improperly distribute client information.');

  h2('14. NON-CIRCUMVENTION');
  p('The Referral Partner shall not intentionally interfere with, redirect, misappropriate, or attempt to divert a client or business opportunity belonging to the Company for their own benefit or for the benefit of a competing business after introducing that client to the Company.');
  p('Similarly, the Company shall not intentionally deny a properly documented qualifying referral solely for the purpose of avoiding payment of legitimately earned commission.');

  h2('15. NON-EXCLUSIVITY');
  p('This Agreement is non-exclusive.');
  p('The Company may appoint other referral partners, marketing partners, contractors, sales representatives, or business development personnel.');
  p("The Referral Partner may engage in other lawful business activities provided that such activities do not involve misuse of the Company's confidential information or false representation of the Company's services.");

  h2('16. EXPENSES');
  p('Unless approved in writing beforehand, the Referral Partner shall be responsible for their own expenses associated with sourcing or referring prospective clients.');
  p('The Company shall not be responsible for transportation costs, advertising costs, telephone expenses, internet costs, entertainment expenses, or other costs incurred by the Referral Partner.');

  h2('17. INDEPENDENT CONTRACTOR RELATIONSHIP');
  p(`The Referral Partner is an independent contractor and not an employee of ${company}.`);
  p('Nothing in this Agreement creates an employer-employee relationship, partnership, joint venture, franchise, or legal agency between the Parties.');
  p('The Referral Partner is responsible for any personal tax obligations arising from commission payments received under this Agreement.');

  h2('18. PROFESSIONAL CONDUCT');
  p(`The Referral Partner shall not engage in conduct that may reasonably damage the reputation of ${company}.`);
  p('This includes:');
  ul([
    'Fraud;',
    'Harassment;',
    'Misrepresentation;',
    'False advertising;',
    'Unauthorized promises;',
    'Unethical solicitation;',
    'Illegal activity;',
    'Misuse of Company branding.'
  ]);
  p('The Company reserves the right to immediately terminate this Agreement where serious misconduct occurs.');

  h2('19. INTELLECTUAL PROPERTY AND BRANDING');
  p(`All Company names, logos, graphics, proposals, systems, marketing materials, documents, trademarks, designs, software, and other intellectual property remain the property of ${company} or their respective owners.`);
  p('The Referral Partner may only use Company branding where authorized.');
  p('No ownership rights are transferred under this Agreement.');

  h2('20. TERM');
  p(`This Agreement shall commence on **${d.effectiveDate}** and shall continue until terminated by either Party in accordance with this Agreement.`);

  h2('21. TERMINATION');
  p(`Either Party may terminate this Agreement by providing **${noticeDays} days' written notice** to the other Party.`);
  p('The Company may terminate the Agreement immediately where the Referral Partner:');
  ul([
    'Commits fraud;',
    'Misrepresents the Company;',
    'Misuses client information;',
    "Damages the Company's reputation;",
    'Collects unauthorized payments;',
    'Breaches confidentiality;',
    'Engages in unlawful conduct;',
    'Materially breaches this Agreement.'
  ]);
  p("Termination shall not remove the Referral Partner's right to properly earned commission relating to qualifying referrals made before termination, provided all requirements under this Agreement are satisfied.");

  h2('22. CHANGES TO COMMISSION STRUCTURE');
  p('The Company may change its referral commission programme from time to time.');
  p('Changes shall not retroactively reduce commission already earned on a qualifying referral.');
  p('Any revised commission arrangement shall apply prospectively after reasonable notice is provided to the Referral Partner.');

  h2('23. DISPUTE RESOLUTION');
  p('The Parties agree to first attempt to resolve any dispute arising from this Agreement through good-faith discussion and negotiation.');
  p('Where a dispute cannot be resolved informally, the Parties may pursue any lawful dispute-resolution process available to them.');

  h2('24. GOVERNING LAW');
  p('This Agreement shall be governed by and interpreted in accordance with the laws of **Jamaica**.');
  p('The Parties agree that any legal proceedings arising from this Agreement shall, unless otherwise required by law, be subject to the jurisdiction of the courts of Jamaica.');

  h2('25. ENTIRE AGREEMENT');
  p('This Agreement constitutes the entire understanding between the Parties concerning the referral relationship and supersedes prior verbal or written discussions concerning the same subject matter.');
  p('Any significant amendment to this Agreement should be made in writing and acknowledged by both Parties.');

  h2('26. SEVERABILITY');
  p('If any provision of this Agreement is found to be invalid or unenforceable, the remaining provisions shall continue in full force and effect to the extent permitted by law.');

  h2('27. ELECTRONIC SIGNATURES');
  p('The Parties agree that this Agreement may be signed physically or electronically.');
  p('Electronic signatures, digital acceptance, scanned signatures, and electronically transmitted signed copies may be treated as evidence of acceptance to the extent permitted by applicable law.');

  // Optional per-partner additions chosen by the Company before sending.
  if (d.additionalTerms && d.additionalTerms.length) {
    h2('28. ADDITIONAL TERMS AGREED FOR THIS REFERRAL PARTNER');
    ol(d.additionalTerms);
  }

  if (d.agreementReference) S.push({ type: 'field', label: 'Agreement Reference', value: d.agreementReference });

  // "SIGNATURES" heading + statement. The e-sign page shows it as text; the PDF draws it itself,
  // directly above the signature boxes.
  S.push({ type: 'signatures-intro', title: 'SIGNATURES', text: `By signing below, each Party confirms that they have read, understood, and voluntarily agreed to the terms contained in this ${REFERRAL_TEMPLATE.title}.` });

  return S;
}

/** Rows shown in the signing-request email's "Agreement Summary" box. */
function referralSummaryRows(d) {
  return [
    ['Agreement', REFERRAL_TEMPLATE.shortTitle],
    [`Projects under ${formatJmd(d.commissionThresholdAmount)}`, `${formatJmd(d.flatCommissionAmount)} per completed referral`],
    [`Projects of ${formatJmd(d.commissionThresholdAmount)}+`, `${percentText(d.commissionPercent)}% of the amount received`],
    ['Commission paid', `Within ${d.paymentDueDays} business days of the client's payment clearing`]
  ];
}

module.exports = {
  REFERRAL_TEMPLATE_ID,
  REFERRAL_COMPANY_SLUG,
  REFERRAL_COMPANY_SIGNER,
  REFERRAL_COMPANY_POSITION,
  REFERRAL_DEFAULTS,
  REFERRAL_TEMPLATE,
  REFERRAL_ACKNOWLEDGEMENTS,
  percentWords,
  formatJmd,
  percentText,
  normalizeReferralTerms,
  buildReferralFields,
  renderReferralSections,
  referralSummaryRows
};
