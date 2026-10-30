// A project addendum for an existing client. Standard agreements keep their original wording.
const VERSION = 'continuation-v1';
function continuingAcknowledgements() {
  return [
    { key: 'deposit_ack', title: 'Phase 2 payment arrangement', text: d => `I accept the stated development fee and payment arrangement, including the ${d.depositPercent}% initial payment for this additional phase. The initial payment is applied to this phase and becomes non-refundable once its authorized work starts.` },
    { key: 'variable_pricing_ack', title: 'Scope and approved changes', text: () => 'I have reviewed the Phase 2 deliverables. Additional work, third-party costs and changes to this scope or price require written approval before being incurred.' },
    { key: 'key_clauses_ack', title: 'Continuing relationship', text: () => 'I accept this continuing-development addendum. It supplements the earlier Sky Beach website agreement; the earlier terms continue except where this addendum expressly changes the additional phase. I am authorized to sign for the client business.' },
    { key: 'signature_confirmation', title: 'Electronic signature consent', text: () => 'I have reviewed this addendum, voluntarily agree to transact electronically, and intend my signature and submission to evidence acceptance. A person copied on a reference email does not become a signatory.' }
  ];
}
function renderContinuingDevelopmentSections(d) {
  const S = [], add = (type, text) => S.push({ type, text });
  const field = (label, value) => S.push({ type: 'field', label, value });
  add('title', 'CONTINUING DEVELOPMENT AGREEMENT');
  add('p', 'Sky Beach - Phase 2 Operations Management System');
  add('h2', '1. Parties and continuation of the existing project');
  field('Developer', 'Shamar Baker, trading as iCreate Solutions & Services');
  field('Client representative', d.clientName);
  field('Client business', d.businessName);
  field('Client email', d.clientEmail);
  field('Agreement reference', d.agreementReference);
  add('p', 'This addendum records additional development for the existing Sky Beach website client. It supplements the parties\' earlier agreement for the Sky Beach website (Phase 1); it does not treat the Client as a new client, restart Phase 1, or charge again for completed Phase 1 work.');
  add('p', 'The earlier agreement remains in force except where this addendum expressly changes the scope, fee or payment arrangement for Phase 2. This addendum takes precedence only for those Phase 2 matters. It does not replace previously agreed hosting, maintenance or ownership arrangements. No later website terms are substituted for the earlier agreement through this addendum.');
  add('h2', '2. Phase 2 scope and deliverables');
  field('Project', d.projectType);
  for (const paragraph of d.projectDescription.split(/\n\s*\n/).filter(Boolean)) add('p', paragraph);
  add('h2', '3. Development fee and payment');
  field('Total Phase 2 development fee', `${d.currency} $${d.cost.toLocaleString('en-US', {minimumFractionDigits:2})}`);
  field('Initial payment', `${d.depositPercent}% - ${d.currency} $${d.depositAmount.toLocaleString('en-US', {minimumFractionDigits:2})}`);
  field('Completion payment', `${d.balancePercent}% - ${d.currency} $${d.balanceAmount.toLocaleString('en-US', {minimumFractionDigits:2})}`);
  add('p', d.paymentArrangement);
  add('p', 'The initial payment is credited toward the total development fee and becomes non-refundable after authorized Phase 2 work starts. Signing accepts the payment arrangement written above; any different instalment plan must be recorded and approved by both parties before it replaces that arrangement. No payment is represented as already received by this document.');
  add('p', 'The development fee is fixed for the scope above. Scope additions, new integrations, substantial redesigns and third-party expenses require a written quote and the Client\'s written approval before the additional work or cost is incurred. Included no-extra-development-cost features remain within the stated fee.');
  add('h2', '4. Delivery, review and client cooperation');
  add('p', 'The parties will confirm a written implementation plan and target dates after signing, receipt of the initial payment, and provision of the required business information and access. No fixed completion date has yet been agreed. Delays caused by missing information, delayed approvals or third-party access will be reflected in an updated plan communicated to the Client.');
  add('p', 'The Client will nominate an authorized decision-maker, provide approved menus and prices, initial records, operational rules, staff access requirements and relevant account access, and arrange timely review by management. The Developer will use these inputs to configure the approved scope and demonstrate it using appropriate test records before production use.');
  add('p', 'Completion means the agreed functions are implemented, demonstrated and made available for the Client to review. The Client may report specific material defects against this scope; the Developer will correct those defects before final acceptance and handover. The parties will record acceptance in writing. The remaining payment becomes due on completion and acceptance, before final delivery or transfer of the Phase 2 work.');
  add('p', 'Handover will include the authorized management access and instructions needed to use the delivered functions. Ongoing maintenance, hosting, subscriptions and support remain governed by the existing agreement or a separately accepted arrangement; they are not newly priced or silently renewed by this addendum.');
  add('h2', '5. Operational boundaries and existing protections');
  add('p', 'The Client retains ownership of its business content and records. Confidentiality, intellectual property, liability, termination and dispute terms in the earlier agreement continue to apply except as expressly varied here. Payment for Phase 2 does not remove rights already obtained for paid Phase 1 work.');
  add('p', 'Role-based access will separate owner, management and supervisor responsibilities. Personal and business records will be handled for the agreed operational purpose. Marketing communications require appropriate consent and an approved sending arrangement. Operational finance summaries are not a replacement for statutory accounts, tax advice or professional accounting services.');
  add('p', 'The system depends on third-party hosting, database, analytics and any separately approved integrations. Provider fees and access conditions will be disclosed for approval. The Developer will not promise automatic synchronization with an existing POS or external online-menu platform without first verifying access and agreeing that integration in writing.');
  add('h2', '6. Acceptance and signatures');
  add('p', 'By signing, the Client confirms authority to act for the business, accepts this Phase 2 scope and payment arrangement, and agrees to electronic execution and retention of the agreement. The effective date is the date of the Client\'s signature after the Company has approved issuance. A review draft, preview, email copy or earlier visual workspace is not itself evidence that Phase 2 has been signed or paid.');
  field('Company signatory', d.companySignerName);
  field('Company contact', 'icreatesolutions.ja@gmail.com | 876-585-7469 | icreatesolutionsandservices.com');
  field('Governing law', 'Jamaica');
  field('Version', VERSION);
  return S;
}
module.exports = { VERSION, continuingAcknowledgements, renderContinuingDevelopmentSections };
