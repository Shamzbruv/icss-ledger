/**
 * Contract Template — single source of truth for the Project Service Agreement text.
 *
 * `buildContractData()` normalizes a `contracts` row (or a frozen `terms_snapshot_json`)
 * into the values used to fill in the agreement. `renderContractSections()` returns the
 * legal text as a structured block list, which `renderContractHtml()` (used by the public
 * sign page) and `contractPdfService.js` (used for the PDF) both render from — so the
 * wording never has to be kept in sync by hand across the two outputs.
 *
 * The interactive acknowledgement checkboxes and the signature capture itself are NOT part
 * of this narrative text — they live in `ACKNOWLEDGEMENTS` below and are rendered as real
 * form controls / checked items by the sign page and PDF respectively.
 */

const COMPANY_NAME = 'I Create Solutions & Services';
const COMPANY_WEBSITE = 'icreatesolutionsandservices.com';
const COMPANY_TERMS_URL = `${COMPANY_WEBSITE}/terms`;
const COMPANY_EMAIL = 'ICreatesolutions.ja@gmail.com';
const COMPANY_PHONE = '(876) 585-7469 / (876) 582-5685';
const GOVERNING_LAW = 'Jamaica';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency || 'JMD'} $${formatted}`;
}

function formatDateLong(dateInput) {
  if (!dateInput) return null;
  try {
    return new Date(dateInput).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) {
    return null;
  }
}

function defaultPaymentArrangement(depositPercent, balancePercent) {
  return `${depositPercent}% deposit due before project work begins; the remaining ${balancePercent}% balance is due upon completion of the project, before final delivery/transfer of the completed work.`;
}

/**
 * Normalizes a raw `contracts` row (or a frozen `terms_snapshot_json` object) into the
 * flat set of values the template needs.
 */
function buildContractData(contract) {
  const depositPercent = Number(contract.deposit_percent ?? 50);
  const balancePercent = Math.max(0, round2(100 - depositPercent));
  const cost = Number(contract.project_cost ?? 0);
  const currency = contract.currency || 'JMD';
  const depositAmount = round2((cost * depositPercent) / 100);
  const balanceAmount = round2(cost - depositAmount);

  return {
    clientName: contract.client_name || '',
    businessName: contract.business_name || '',
    clientEmail: contract.client_email || '',
    clientPhone: contract.client_phone || '',
    projectType: contract.project_type || '',
    projectDescription: contract.project_description || '',
    currency,
    cost,
    depositPercent,
    balancePercent,
    depositAmount,
    balanceAmount,
    paymentArrangement: contract.payment_arrangement || defaultPaymentArrangement(depositPercent, balancePercent),
    companySignerName: contract.company_signer_name || 'S. Baker',
    companySignedAt: contract.company_signed_at || null,
    agreementReference: contract.agreement_reference || '',
    contractVersion: contract.contract_version || 'v1'
  };
}

// The four required acknowledgements. Rendered as real checkboxes on the sign page and as
// checked/unchecked items in the generated PDF — the wording here is the single source of
// truth for both, and is also used server-side to validate a signature submission.
const ACKNOWLEDGEMENTS = [
  {
    key: 'deposit_ack',
    title: 'Acknowledgement of Deposit',
    text: (d) => `I acknowledge and agree that the required initial deposit of ${d.depositPercent}% of the estimated project cost must be paid before work begins, and that the deposit becomes non-refundable once project work has commenced.`
  },
  {
    key: 'variable_pricing_ack',
    title: 'Acknowledgement of Variable Pricing',
    text: () => `I understand that the project price is based upon the currently agreed scope and may increase if I request additional features, changes, integrations, services, or other work outside the agreed scope, or where required third-party costs arise.`
  },
  {
    key: 'key_clauses_ack',
    title: 'Key Clauses Acceptance',
    text: () => `I have read and agree to the Legal Terms & Conditions set out in Section 4 of this Agreement, including the provisions on intellectual property, third-party services, limitation of liability, and governing law, and specifically confirm each of the points below:`,
    items: [
      'I have reviewed the project information provided to me.',
      'I understand that the initial deposit is required before development begins.',
      'I understand that the deposit is non-refundable after work has commenced.',
      'I understand that changes outside the agreed scope may result in additional charges.',
      'I understand that third-party costs may not be included unless expressly stated.',
      "I understand that intellectual property rights remain subject to the Company's intellectual-property provisions until all required payments have been received.",
      'I understand that the Company does not control third-party providers or guarantee third-party uptime or approval.',
      'I understand that the Company does not guarantee specific financial or business results.',
      "I have been provided access to the Company's full Terms & Conditions.",
      'I agree to conduct this transaction electronically.',
      'I intend my electronic signature and submission of this Agreement to evidence my acceptance of these terms.'
    ]
  },
  {
    key: 'signature_confirmation',
    title: 'Signature Confirmation',
    text: () => `By checking this box, signing below, and submitting this Agreement, I confirm that the electronic signature is mine and that I intend to enter into and be bound by this Agreement.`
  }
];

/**
 * Returns the narrative legal text as a structured block list:
 *   { type: 'title'|'h1'|'h2'|'h3'|'p'|'ul'|'ol'|'field', ... }
 */
function renderContractSections(d) {
  const S = [];
  const p = (text) => S.push({ type: 'p', text });
  const h1 = (text) => S.push({ type: 'h1', text });
  const h2 = (text) => S.push({ type: 'h2', text });
  const h3 = (text) => S.push({ type: 'h3', text });
  const ul = (items) => S.push({ type: 'ul', items });
  const ol = (items) => S.push({ type: 'ol', items });
  const field = (label, value, long = false) => S.push({ type: 'field', label, value, long });

  S.push({ type: 'title', text: 'PROJECT SERVICE AGREEMENT & TERMS ACCEPTANCE' });

  p(`This Project Service Agreement & Terms Acceptance ("Agreement") is issued by ${COMPANY_NAME} ("Company", "we", "us", or "our") and is entered into between the Company and the individual or business identified below ("Client", "you", or "your").`);
  p(`This Agreement governs the specific digital project, service, or services requested by the Client and should be read together with the Company's Terms & Conditions published at ${COMPANY_TERMS_URL}.`);
  p('By completing, electronically signing, and submitting this Agreement, the Client confirms that they have reviewed, understood, and agreed to be legally bound by this Agreement and the applicable Terms & Conditions.');

  // --- SECTION 1 ---
  h1('SECTION 1 OF 5');
  h2('Project Service Agreement & Terms Acceptance');
  p(`${COMPANY_NAME} provides digital and technology-related services, including but not limited to:`);
  ul([
    'Website design and development', 'Web application development', 'Mobile application development',
    'Custom software development', 'UI/UX design', 'Graphic design and branding', 'Business automation',
    'Booking and appointment systems', 'Customer relationship management systems',
    'Inventory and order management systems', 'Membership and subscription systems', 'Payment integrations',
    'API and third-party integrations', 'Hosting, maintenance, technical support, and related digital services',
    'Other custom technology solutions agreed upon between the Company and Client'
  ]);
  p('The specific services to be provided for this project shall be determined by the project description, quotation, proposal, invoice, written correspondence, approved feature list, or other documentation associated with the project.');

  h3('Important Financial Notices');
  h3('Deposit');
  p(`A deposit of ${d.depositPercent}% of the estimated project cost, unless another amount or payment structure is expressly agreed to in writing, is required before project development begins.`);
  p('Once work has commenced, the deposit is non-refundable and will be applied toward the agreed project cost.');
  p('The Company is not required to commence development, reserve development resources, purchase third-party services, or deliver preliminary or final work until the required initial payment has been received.');

  h3('Estimated Pricing');
  p('Any project price entered into this Agreement is considered the estimated or currently agreed project cost based upon the scope known at the time of acceptance.');
  p('The Client understands that the final cost may change where:');
  ul([
    'Additional features are requested', 'Existing approved features are materially changed',
    'The Client changes the original project scope',
    'Additional pages, screens, integrations, functions, or services are requested',
    'Third-party services or licenses are required',
    'App store, hosting, API, payment gateway, software, domain, messaging, database, or platform fees arise',
    'Previously unknown technical requirements are discovered',
    'The Client requests significant redesigns after approving a design or development stage',
    'Additional work is required that was not reasonably included in the original scope'
  ]);
  p('Where reasonably possible, the Company will notify the Client of material additional charges before undertaking the additional work.');
  p("Approval may be provided electronically, including by email, messaging platform, the Company's client portal/admin system, invoice approval, recorded meeting confirmation, or other written electronic communication.");
  p('Approved additions become part of this Agreement.');

  h3('Quotations and Estimates');
  p('Unless otherwise stated in writing, quotations and project estimates are valid for 14 days from the date issued.');
  p("A quotation is based on the information available to the Company at the time it is prepared and may be revised where the Client's requirements subsequently change.");

  h3('Project Commencement');
  p('For the purposes of this Agreement, work may be considered to have commenced once the Company begins any project-specific activity, including:');
  ul([
    'Planning', 'Consultation', 'Research', 'Wireframing', 'UI/UX design', 'Graphic design', 'Database planning',
    'Coding', 'Configuration', 'Project setup', 'Purchasing or configuring third-party services',
    'Creating prototypes', 'Preparing project assets', 'Allocating development resources'
  ]);

  // --- SECTION 2 ---
  h1('SECTION 2 OF 5');
  h2('Client Information & Project Details');

  h3('Full Name');
  field('Client Full Name', d.clientName);
  h3('Business Name');
  field('Business Name', d.businessName || 'N/A');
  p('Where the Client is entering into this Agreement on behalf of a business or organization, the Client confirms that they have sufficient authority to enter into this Agreement on behalf of that organization.');
  h3('Email Address');
  field('Email Address', d.clientEmail);
  p('The Client agrees that the email address supplied may be used for project communication, notices, invoices, approvals, account information, contractual notices, and other communications relating to the Company\'s services.');
  h3('Telephone / WhatsApp');
  field('Phone', d.clientPhone || 'N/A');
  h3('Project Type');
  field('Project Type', d.projectType || 'N/A');
  h3('Project Description');
  field('Description', d.projectDescription || 'N/A', true);
  p('The Client acknowledges that this description is intended to identify the general purpose of the project. Detailed features, deliverables, functions, pages, screens, integrations, deadlines, pricing, and other requirements may also be established through the Company\'s quotation, proposal, project specification, invoice, email correspondence, client portal, or other written project documentation.');

  h3('Scope of Work');
  p('The Company is responsible only for work that has been expressly included in the agreed project scope. A request shall not automatically become part of the original project merely because:');
  ul([
    'It was discussed informally', 'The Client assumed it would be included',
    'It is commonly available in another product',
    "It appears in a competitor's website, software, or application",
    'It becomes desirable after development has started'
  ]);
  p('Any feature or service not reasonably included within the agreed scope may be treated as additional work and quoted separately.');

  h3('Client Responsibilities');
  p('The Client agrees to provide all information and materials reasonably required to complete the project, including where applicable:');
  ul([
    'Business information', 'Product information', 'Written content', 'Images and videos',
    'Logos and branding materials', 'Prices', 'Policies', 'Login credentials', 'Domain access', 'Hosting access',
    'API credentials', 'Payment gateway information', 'App store information', 'Database information',
    'Business rules', 'Feedback', 'Approvals'
  ]);
  p('The Client represents that they have permission to provide and use all material supplied to the Company. The Company will not be responsible for copyright, trademark, privacy, intellectual-property, regulatory, or other claims resulting from material or instructions supplied by the Client.');

  h3('Client Delays');
  p('Project timelines are based partly upon the Client providing information, feedback, approvals, payments, and access within a reasonable period. Delays by the Client may result in:');
  ul([
    'Extension of the delivery date', 'Rescheduling of development', 'Temporary project inactivity',
    'Additional charges where substantial remobilization is required'
  ]);
  p('An estimated completion date is therefore not a guaranteed completion date unless expressly stated in writing as such.');

  // --- SECTION 3 ---
  h1('SECTION 3 OF 5');
  h2('Project Terms & Financials');

  h3('Estimated Project Cost');
  field('Estimated/Agreed Project Cost', formatMoney(d.cost, d.currency));
  p('The Client confirms that this amount corresponds with the estimate, quotation, proposal, invoice, or pricing information supplied by the Company at the time this Agreement is accepted.');

  h3('Payment Structure');
  p('Unless otherwise agreed in writing:');
  field('Initial Deposit', `${d.depositPercent}% (${formatMoney(d.depositAmount, d.currency)})`);
  field('Remaining Balance', `${d.balancePercent}% (${formatMoney(d.balanceAmount, d.currency)})`);
  p('The remaining balance shall become due according to the agreed payment schedule, project milestone, or upon completion of the project before final transfer or release of applicable deliverables.');
  p('For projects using milestone payments, subscriptions, installment plans, retainers, or other customized payment arrangements, the payment schedule shown below and/or on the corresponding quotation, invoice, or project record shall apply.');

  h3('Agreed Payment Arrangement for This Project');
  field('Payment Arrangement', d.paymentArrangement, true);

  h3('Additional Work and Change Requests');
  p('The Client may request changes during the project. Minor corrections reasonably connected to the approved scope may be completed at the Company\'s discretion without additional charges.');
  p('However, substantial revisions, new features, repeated redesigns, additional integrations, structural changes, or requests outside the agreed scope may result in additional fees and timeline changes. The Company reserves the right to determine whether a request constitutes:');
  ol(['A correction', 'A revision', 'A scope change', 'A separate project']);
  p('Where additional payment is required, the Company may pause the affected work until the additional cost is accepted.');

  h3('Third-Party Costs');
  p('Unless expressly included in the Company\'s quotation, the Client is responsible for third-party expenses associated with the project. These may include:');
  ul([
    'Domain registration', 'Web hosting', 'Cloud infrastructure', 'Database services', 'Email services',
    'SMS or WhatsApp services', 'Payment gateway charges', 'API charges', 'Application marketplace fees',
    'Apple App Store fees', 'Google Play fees', 'Software subscriptions', 'Premium plugins',
    'Fonts, images, media, or licensed assets', 'Artificial-intelligence services', 'Transaction fees',
    'Currency conversion fees', 'Bank charges'
  ]);
  p('Third-party prices are controlled by their respective providers and may change without notice.');

  h3('Late Payments');
  p('Late or overdue balances may incur a late fee of up to 10% per month on the outstanding balance, or the maximum amount permitted by applicable law, whichever is lower.');
  p('Where a payment becomes overdue, the Company may temporarily:');
  ul([
    'Pause development', 'Pause maintenance', 'Suspend support', 'Withhold deployment',
    'Restrict access to staging systems', 'Restrict access to Company-controlled project resources',
    'Delay transfer of files, code, credentials, or other deliverables'
  ]);
  p('until the outstanding balance is resolved.');

  h3('Cancellation by the Client');
  p('The Client may request cancellation in writing. Where cancellation occurs after work has commenced:');
  ul([
    'The initial deposit remains non-refundable', 'The Client remains responsible for work already performed',
    'The Client remains responsible for approved third-party costs already incurred',
    'Any outstanding amount relating to completed work becomes immediately due'
  ]);
  p('If the value of work completed exceeds the deposit already paid, the Company may invoice the Client for the difference.');

  h3('Suspension or Termination by the Company');
  p('The Company may suspend or terminate services where reasonably necessary, including where:');
  ul([
    'Payments remain overdue', 'The Client repeatedly fails to provide required information',
    'The Client requests unlawful or unethical activity',
    'The Client abuses, threatens, or harasses Company personnel or contractors',
    'The Client materially breaches this Agreement',
    "Continued performance becomes impossible or commercially unreasonable because of circumstances outside the Company's reasonable control"
  ]);
  p('Termination does not cancel payment obligations relating to services already performed or expenses already incurred.');

  // --- SECTION 4 ---
  h1('SECTION 4 OF 5');
  h2('Legal Terms & Conditions');

  h3('Full Terms Reference');
  p(`This Project Service Agreement should be read together with the ${COMPANY_NAME} Terms & Conditions available at: ${COMPANY_TERMS_URL}`);
  p('For this particular project, the applicable website Terms shall be the Terms in effect on the Date of Agreement, unless the parties subsequently agree otherwise in writing.');
  p('The project quotation, approved scope, this Agreement, applicable invoices, and incorporated Terms collectively form the agreement between the Company and Client relating to the project. Where there is a direct conflict concerning a project-specific matter, the expressly agreed project-specific provision shall apply to that matter.');

  h3('Intellectual Property');
  p('Unless the parties expressly agree otherwise in writing, all original code, designs, graphics, layouts, software architecture, systems, automations, concepts, documentation, and other project materials created by the Company remain the intellectual property of the Company until all required amounts have been paid in full.');
  p("Full payment does not automatically transfer ownership of the Company's:");
  ul([
    'Reusable source code', 'Development frameworks', 'Internal libraries', 'Templates', 'Processes',
    'Development techniques', 'Generic components', 'Pre-existing intellectual property', 'Proprietary systems',
    'Tools used to create the final product'
  ]);
  p("Upon full payment, the Client receives the rights or license applicable to the completed deliverables as specified by the project agreement and Company's Terms.");
  p('The Company may reuse general, non-confidential development methods, components, concepts, frameworks, and knowledge acquired while performing the project.');

  h3('Portfolio Rights');
  p('Unless otherwise agreed in writing or restricted by a confidentiality or non-disclosure agreement, the Client grants the Company permission to identify and display completed or publicly released portions of the project within:');
  ul(['The Company\'s portfolio', 'Website', 'Social media', 'Business presentations', 'Marketing material', 'Case studies', 'Sales presentations']);
  p('Confidential Client information shall not be intentionally published as part of such use.');

  h3('Third-Party Services');
  p('The Client acknowledges that digital projects may depend upon external providers, including hosting companies, domain registrars, cloud infrastructure providers, payment processors, APIs, communication platforms, app stores, database providers, social networks, and software vendors.');
  p(`${COMPANY_NAME} does not own or control those providers. Accordingly, the Company cannot guarantee:`);
  ul([
    'Continuous third-party availability', 'Third-party uptime', 'Unchanged third-party pricing',
    'Continued API availability', 'Continued compatibility', 'Approval by Apple, Google, payment providers, or other third parties',
    'Third-party security', 'Third-party account approval', 'Third-party processing times'
  ]);
  p('The Company shall not be held responsible for outages, suspensions, policy changes, price changes, account closures, service discontinuation, or other failures caused primarily by a third-party provider. Where possible, the Company may assist the Client with resolving such issues, but additional development or support charges may apply.');

  h3('App Store and Platform Approval');
  p('Where the project involves Apple, Google, Meta, payment processors, hosting companies, financial technology providers, or another platform requiring approval, the Client understands that the Company cannot guarantee approval. The Company may develop the project according to published requirements and commercially reasonable practices, but final approval remains under the control of the relevant platform. Changes requested by a platform after submission that were not reasonably foreseeable may constitute additional work.');

  h3('Confidentiality');
  p('Both the Company and Client agree to use reasonable measures to protect confidential, non-public information obtained during the project. Confidential information may include:');
  ul([
    'Passwords', 'Credentials', 'Business records', 'Customer information', 'Internal processes',
    'Financial information', 'Proprietary systems', 'Business strategies', 'Unreleased products',
    'Private project information'
  ]);
  p('Confidential information may be shared where necessary with employees, developers, subcontractors, professional advisers, infrastructure providers, or other persons involved in providing the services, provided appropriate confidentiality obligations apply. Disclosure may also occur where required by law.');

  h3('Data Protection');
  p('Personal information collected during the project may be used for legitimate project and business purposes including:');
  ul(['Communication', 'Account administration', 'Billing', 'Support', 'Project delivery', 'Security', 'Recordkeeping', 'Compliance with legal obligations']);
  p('The Company will take reasonable measures to protect information under its control and will handle applicable personal information in accordance with relevant data-protection obligations.');

  h3('Backups and Data');
  p('Where backups are included within a specific hosting, maintenance, or support service, the Company will use commercially reasonable measures to perform such backups. Unless specifically included within the agreed service, the Company does not guarantee permanent storage or recovery of Client information. Clients should maintain independent copies of important business data where reasonably possible.');

  h3('Security');
  p('The Company will use commercially reasonable development and security practices based upon the nature of the project. However, no website, application, database, server, network, or other digital system can be guaranteed to be completely immune from:');
  ul(['Cyberattacks', 'Malware', 'Unauthorized access', 'Zero-day vulnerabilities', 'Third-party security failures', 'Human error', 'Credential theft', 'Service interruption']);
  p('The Client acknowledges these inherent technological risks.');

  h3('Testing and Acceptance');
  p('The Client will be given a reasonable opportunity, where applicable, to review and test the completed project or relevant project milestone. The Client is responsible for reporting material errors discovered during the review process. A project may be considered accepted where:');
  ul([
    'The Client expressly approves it', 'The Client authorizes deployment or publication',
    'The Client begins commercially using the deliverable',
    'The Client fails to report material problems within a reasonable review period after being asked to review the completed work'
  ]);
  p('Minor errors that do not materially prevent the primary function of the project will not normally constitute grounds for withholding the entire outstanding balance.');

  h3('Warranty and Support');
  p('Unless a separate maintenance, subscription, warranty, or support plan has been purchased, continued updates, enhancements, maintenance, content changes, third-party compatibility work, or ongoing technical assistance are not automatically included indefinitely after project completion.');
  p('Any complimentary post-launch correction period offered by the Company applies only to defects relating to the originally approved scope and does not include:');
  ul(['New features', 'New designs', 'Client-created errors', 'Third-party changes', 'Platform changes', 'Damage caused by another developer', 'Changes to hosting environments', 'Changes caused by the Client or another administrator']);

  h3('No Guarantee of Business Results');
  p('Although the Company develops solutions intended to assist the Client\'s operations, the Company does not guarantee:');
  ul(['Revenue', 'Profit', 'Customer acquisition', 'Search engine rankings', 'Sales', 'Downloads', 'User adoption', 'Investment', 'Market success', 'Business growth', 'Any particular financial result']);
  p("Business performance may depend upon numerous circumstances beyond the Company's control.");

  h3('Limitation of Liability');
  p(`To the maximum extent permitted by applicable law, ${COMPANY_NAME}, its owners, personnel, and contractors shall not be responsible for indirect, incidental, special, consequential, or punitive loss arising from the services, including loss of:`);
  ul(['Revenue', 'Profit', 'Business opportunity', 'Data', 'Customers', 'Goodwill', 'Expected savings']);
  p("To the maximum extent permitted by law, the Company's total aggregate liability relating to a particular project shall not exceed the total amount actually paid by the Client to the Company for the specific project or service giving rise to the claim.");
  p('Nothing in this Agreement is intended to exclude liability that cannot lawfully be excluded.');

  h3('Indemnification');
  p('The Client agrees to be responsible for claims, losses, costs, or liabilities arising primarily from:');
  ul([
    'Unlawful content supplied by the Client', 'Copyrighted or trademarked material supplied without authorization',
    'Client-provided customer data', 'Misuse of the completed system', 'Client instructions that violate applicable law',
    'Products or services sold by the Client through the completed system',
    'Statements, advertisements, policies, or representations created or supplied by the Client'
  ]);

  h3('Force Majeure');
  p('The Company will not be considered in breach of this Agreement for delays or inability to perform caused by circumstances beyond its reasonable control. These circumstances may include:');
  ul([
    'Hurricanes', 'Floods', 'Earthquakes', 'Fire', 'Natural disasters', 'War', 'Civil unrest',
    'Government restrictions', 'Pandemic or public-health emergencies', 'Internet outages', 'Power outages',
    'Hosting failures', 'Telecommunications failures', 'Major third-party platform failures',
    "Other events reasonably outside the Company's control"
  ]);
  p('Affected deadlines may be extended accordingly.');

  h3('Dispute Resolution');
  p(`If a dispute arises, the Client and Company agree to first make a reasonable good-faith attempt to resolve the issue through direct discussion or written communication. If the dispute cannot be resolved informally, the dispute may be referred to mediation, arbitration, or another lawful dispute-resolution process in ${GOVERNING_LAW} in accordance with applicable ${GOVERNING_LAW} law and the Company's Terms & Conditions.`);

  h3('Governing Law');
  p(`This Agreement is primarily governed by the laws of ${GOVERNING_LAW}.`);
  p("Where services are provided to an international Client, any mandatory protections or laws that cannot legally be excluded in the Client's jurisdiction will continue to apply to the extent required by law.");

  h3('Severability');
  p('If any part of this Agreement is found to be invalid, illegal, or unenforceable, that provision shall, where legally possible, be interpreted or limited to the minimum extent required to make it enforceable. The remainder of the Agreement shall continue in effect.');

  h3('Entire Agreement and Project Records');
  p('This Agreement, together with the applicable quotation, proposal, project specification, invoice, approved change requests, and incorporated Terms & Conditions, represents the agreement governing the project.');
  p('Written electronic project communications may be used as evidence of:');
  ul(['Requested changes', 'Client approvals', 'Pricing changes', 'Scope adjustments', 'Delivery decisions', 'Payment arrangements', 'Project instructions']);

  // --- SECTION 5 ---
  h1('SECTION 5 OF 5');
  h2('Agreement & Electronic Signature');

  h3('Final Acceptance');
  p('By electronically signing below, I confirm that:');
  ol([
    'I have read this Project Service Agreement',
    "I have had the opportunity to review the Company's Terms & Conditions",
    'The information I supplied is accurate to the best of my knowledge',
    'I understand the payment obligations associated with my project',
    'I understand that additional work may result in additional charges',
    'I understand the intellectual-property provisions applicable to the project',
    'I voluntarily agree to conduct this transaction electronically',
    'I intend my electronic signature to authenticate this Agreement and demonstrate my consent to be bound by it',
    'If signing for a company, organization, church, business, or other entity, I represent that I am authorized to enter into this Agreement on its behalf'
  ]);

  h3('Company Information');
  field('Company', COMPANY_NAME);
  field('Website', COMPANY_WEBSITE);
  field('Email', COMPANY_EMAIL);
  field('Phone / WhatsApp', COMPANY_PHONE);
  field('Governing Jurisdiction', GOVERNING_LAW);

  h3('Electronic Record Notice');
  p('The Client agrees that this Agreement may be created, accepted, signed, transmitted, retained, and reproduced electronically. The Company may retain an electronic record of this Agreement together with associated acceptance information for legal, operational, security, accounting, and recordkeeping purposes. The Client should receive or be provided with access to a copy of the completed Agreement after submission.');

  if (d.agreementReference) {
    field('Agreement / Project Reference', d.agreementReference);
  }
  field('Contract Version', d.contractVersion);

  return S;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

/**
 * Renders the structured sections to an HTML fragment for the public sign page
 * (and for any future admin "preview" view).
 */
function renderContractHtml(contract) {
  const d = buildContractData(contract);
  const sections = renderContractSections(d);

  const parts = sections.map((block) => {
    switch (block.type) {
      case 'title':
        return `<h1 class="contract-title">${escapeHtml(block.text)}</h1>`;
      case 'h1':
        return `<div class="contract-eyebrow">${escapeHtml(block.text)}</div>`;
      case 'h2':
        return `<h2 class="contract-h2">${escapeHtml(block.text)}</h2>`;
      case 'h3':
        return `<h3 class="contract-h3">${escapeHtml(block.text)}</h3>`;
      case 'p':
        return `<p class="contract-p">${escapeHtml(block.text)}</p>`;
      case 'ul':
        return `<ul class="contract-ul">${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
      case 'ol':
        return `<ol class="contract-ol">${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>`;
      case 'field':
        return `<div class="contract-field${block.long ? ' contract-field-long' : ''}"><span class="contract-field-label">${escapeHtml(block.label)}</span><span class="contract-field-value">${escapeHtml(block.value)}</span></div>`;
      default:
        return '';
    }
  });

  return parts.join('\n');
}

module.exports = {
  COMPANY_NAME,
  COMPANY_WEBSITE,
  COMPANY_TERMS_URL,
  COMPANY_EMAIL,
  COMPANY_PHONE,
  GOVERNING_LAW,
  formatMoney,
  formatDateLong,
  defaultPaymentArrangement,
  buildContractData,
  renderContractSections,
  renderContractHtml,
  ACKNOWLEDGEMENTS
};
