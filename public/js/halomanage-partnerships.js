// HaloManage Partnership Contract Library
// Static admin-side generator: no contract is saved until the user copies it into the signing workflow.

const HM_TEMPLATES = [
    {
        id: "client-acquisition",
        title: "Client Acquisition & Business Development Partner Agreement",
        shortTitle: "Client Acquisition Partner",
        tag: "Sales & Growth",
        summary: "For sourcing, qualifying and helping convert HaloManage clients. Includes lead attribution, client ownership, authority limits and a post-termination tail.",
        term: "12 months, automatically continuing month-to-month unless terminated",
        scope: "Collected HaloManage revenue from Partner-Sourced Clients first registered by the Partner and accepted by the Company.",
        tail: "180 days",
        supportsFormal: false,
        duties: [
            "Identify businesses and decision-makers that reasonably fit HaloManage's target market.",
            "Conduct lawful outreach, networking, referrals, demonstrations and introductions using approved messaging.",
            "Register prospects promptly in the Company-designated CRM or lead register with accurate source and contact details.",
            "Qualify prospects by business need, timing, decision authority, budget indicators and likely use case.",
            "Arrange discovery meetings, demonstrations and follow-up conversations with the appropriate Company representative.",
            "Maintain an accurate pipeline and provide weekly status updates on active opportunities.",
            "Use only current Company-approved pricing guidance, product descriptions, proposals and brand material.",
            "Promptly hand over material client requirements, objections, commitments and meeting notes.",
            "Avoid duplicate, fabricated, unlawfully obtained or misleading leads.",
            "Comply with applicable privacy, direct-marketing, consumer-protection and anti-bribery requirements."
        ],
        roleTerms: [
            ["Lead Registration and Attribution",
                "A Registered Lead is a prospect entered into the Company's designated lead system before another Company source has already registered or materially developed the same opportunity.\n\nA Partner-Sourced Client is a Registered Lead that was first introduced by the Partner, was not already an active client or documented active opportunity of the Company during the preceding 180 days, and enters a paid HaloManage engagement substantially resulting from the Partner's introduction or documented development activity.\n\nIf attribution is disputed, the Company shall review objective records including CRM timestamps, emails, meeting notes and proposal history and shall not unreasonably deny attribution where the Partner's documented activity was the substantial originating cause of the opportunity."
            ],
            ["Client Ownership and Sales Authority",
                "All end-customer contracts remain contracts of the Company unless expressly agreed otherwise in writing. Sourcing a client does not give the Partner ownership of the client relationship, receivable, customer data, contract, product or intellectual property.\n\nThe Partner may not promise discounts, credits, refunds, exclusivity, financing, warranties, delivery dates, custom functionality, implementation scope or other binding commercial terms unless the exact commitment has been approved by the Company in writing."
            ],
            ["Revenue Tail",
                "If this Agreement ends, the Partner remains eligible for the agreed revenue share on Partner-Sourced Clients contracted before termination and Registered Leads that enter their first paid HaloManage contract within the agreed post-termination tail period, provided the Partner was not terminated for fraud, fabricated leads, bribery, unlawful conduct or deliberate misrepresentation. Unless Schedule A expressly states otherwise, the tail applies only to revenue received during the tail period and does not create a perpetual entitlement."
            ]
        ]
    },
    {
        id: "accounting-payroll",
        title: "Accounting, Finance & Payroll Partner Agreement",
        shortTitle: "Accounting & Payroll Partner",
        tag: "Finance",
        summary: "For bookkeeping, accounting, payroll administration, reconciliations, reporting and controls. Separates preparation from payment approval and protects financial data.",
        term: "12 months, subject to periodic review",
        scope: "All Collected HaloManage Revenue for the applicable calculation period, unless Schedule A limits the pool to a specific business unit or portfolio.",
        tail: "30 days",
        supportsFormal: false,
        duties: [
            "Maintain accurate and orderly accounting records for HaloManage and related approved operations.",
            "Record and classify revenue, expenses, receivables, payables, refunds, chargebacks and approved adjustments.",
            "Perform bank, payment-processor and other account reconciliations on the agreed schedule.",
            "Maintain accounts-receivable and accounts-payable schedules and highlight overdue or unusual balances.",
            "Prepare payroll inputs, approved pay-rate records, overtime, deductions, reimbursements, allowances and other authorized payroll data.",
            "Prepare payroll summaries and exception reports for review before payroll is released.",
            "Coordinate payroll records and statutory deduction information with the Company's approved payroll provider, bank, tax adviser or authorized officer.",
            "Prepare monthly management reports including revenue, expense categories, cash position, outstanding receivables and material variances.",
            "Maintain supporting evidence for material journal entries, manual adjustments and corrections.",
            "Assist with tax, year-end, audit and external-accountant information requests within the agreed scope.",
            "Immediately flag suspected fraud, duplicate payments, unexplained transactions, missing records, payroll anomalies and material reconciliation differences.",
            "Protect banking, payroll, compensation, identity, tax and financial information using strict need-to-know access."
        ],
        roleTerms: [
            ["Payroll and Payment Controls",
                "The Partner may prepare payroll and payment instructions but shall not release funds, create a new bank beneficiary, alter employee bank details, alter an approved pay rate, approve the Partner's own compensation, borrow money, open or close a financial account, or otherwise move Company funds unless Schedule B expressly grants that authority.\n\nAny bank-detail change, pay-rate change, bonus, commission, deduction, refund, write-off or off-cycle payment must be supported by an authorized source record. Where dual approval is required, the Partner shall not bypass that control."
            ],
            ["Financial Integrity and Records",
                "Financial entries shall be supported by invoices, receipts, contracts, payroll records, settlement reports, bank evidence or another reasonable source document. Material manual adjustments must record the date, reason, preparer and approving person.\n\nThe Partner shall not commingle Company funds with personal or third-party funds and shall not intentionally defer, accelerate, reclassify or conceal revenue or expenses for the purpose of changing a revenue-share calculation."
            ],
            ["Professional Scope",
                "Unless separately authorized and appropriately qualified where legally required, the Partner shall not hold out as the Company's external auditor, issue an audit opinion, give regulated investment advice, provide legal advice, or sign a statutory return in the Company's name. Where a licensed professional is required, the Partner shall cooperate with the Company's appointed professional and provide complete records."
            ]
        ]
    },
    {
        id: "interim-general",
        title: "90-Day Interim Strategic Partner Agreement",
        shortTitle: "90-Day General Partner",
        tag: "Interim Leadership",
        summary: "A three-month umbrella agreement for someone covering several responsibilities while HaloManage evaluates and defines a permanent role. Formal general-partnership status is optional, not assumed.",
        term: "Fixed 90-day assessment period; automatically expires unless replaced in writing",
        scope: "The HaloManage revenue pool expressly identified in Schedule A. If Schedule A is silent, only revenue directly attributable to work assigned to the Partner is included.",
        tail: "30 days",
        supportsFormal: true,
        duties: [
            "Carry out the business, operational, client, administrative, growth, project, finance-support or HR-support responsibilities assigned in Schedule B.",
            "Maintain accurate records of work completed, decisions made, outstanding matters and commitments requiring approval.",
            "Attend agreed operating meetings and provide a concise weekly activity and outcomes report.",
            "Escalate material client complaints, security incidents, financial irregularities, legal concerns, delays and delivery risks promptly.",
            "Protect Company credentials, systems, confidential information, customer information, employee information and product information.",
            "Coordinate responsibly with developers, contractors, advisers, clients, vendors and other approved contributors.",
            "Operate only within expressly delegated authority and avoid committing the Company to material obligations without approval.",
            "Participate in Day 30, Day 60 and final role-assessment reviews.",
            "Complete a reasonable handover before the assessment period ends or when requested."
        ],
        roleTerms: [
            ["Fixed Assessment Period",
                "This appointment is intentionally temporary. It begins on the Effective Date and expires automatically at 11:59 p.m. on the date falling ninety (90) calendar days later unless terminated earlier or replaced by a new written agreement.\n\nNo later than fourteen (14) days before expiry, the parties should review performance, business need, role fit, revenue contribution, workload, conduct, judgment and future responsibilities. Expiry does not automatically create employment, a permanent appointment, equity, renewed authority or a continuing revenue-share right."
            ],
            ["Future Role and Replacement Agreement",
                "The Company may propose a more specific agreement before or after the assessment, including a business-development, finance, HR, operations, executive, employment, contractor, equity or formal partnership agreement. Neither party is obligated to accept a replacement agreement.\n\nIf work continues briefly after expiry while a replacement agreement is being documented, authority is limited to preserving existing operations. No additional ownership or management right arises merely from continued discussions or assistance."
            ],
            ["Role Assessment",
                "The Company may assess the Partner against reliability, quality of work, contribution to revenue, customer outcomes, judgment, integrity, financial discipline, communication, confidentiality, initiative, teamwork, recordkeeping, compliance with authority limits and ability to perform the role sustainably."
            ]
        ]
    },
    {
        id: "hr-consulting",
        title: "Human Resources Consulting & Advisory Partner Agreement",
        shortTitle: "HR Consulting Partner",
        tag: "People & Culture",
        summary: "For an HR expert advising HaloManage and ICSS on policy, recruitment, employee relations, performance and HR administration while final employment decisions remain with the Company.",
        term: "12 months, subject to quarterly scope review",
        scope: "All Collected HaloManage Revenue or the specific HR-supported revenue pool stated in Schedule A.",
        tail: "30 days",
        supportsFormal: false,
        duties: [
            "Review and recommend HR policies, procedures, handbooks, forms and people-management standards.",
            "Support workforce planning, organizational structure, job descriptions, role design and staffing plans.",
            "Assist with recruitment workflows, interview structures, candidate evaluation and onboarding.",
            "Advise managers on attendance, conduct, performance, employee relations, documentation and fair process.",
            "Support appraisal systems, development plans, training and succession planning.",
            "Assist with onboarding, offboarding, personnel-file standards and employee lifecycle processes.",
            "Support authorized grievances, workplace reviews and investigations while maintaining impartiality and records.",
            "Prepare HR letters, templates, meeting notes, process guides and recommendations for Company approval.",
            "Advise on leave administration, employee records, compensation benchmarking and reward-process design.",
            "Prepare agreed HR metrics and management reports and identify material people risks.",
            "Escalate allegations involving harassment, discrimination, violence, fraud, theft, safeguarding, serious safety risk, protected disclosures, data breaches or threatened legal action.",
            "Protect employee and candidate personal data and use it only for the authorized HR purpose."
        ],
        roleTerms: [
            ["Employment Decision Authority",
                "Unless expressly delegated in writing, the Partner may recommend but may not independently hire, dismiss, suspend, discipline, promote, demote, change compensation, promise employment terms, settle an employee claim or sign an employment contract on behalf of the Company. Final employment decisions remain with the Company's authorized decision-maker."
            ],
            ["Sensitive Employee Data",
                "Employee and candidate files may include identity, banking, compensation, disciplinary, family, health and other sensitive information. The Partner shall access only the minimum information reasonably necessary for the assigned task and shall not disclose it merely because another manager or third party requests it.\n\nNo Company personal data may be uploaded to an unapproved HR tool, AI service, cloud drive or subcontractor environment without prior authorization and an appropriate data-protection basis."
            ],
            ["Investigations and Employee Relations",
                "Where the Partner assists with a grievance, disciplinary matter, complaint or investigation, the Partner shall disclose conflicts, preserve relevant records, maintain need-to-know confidentiality, avoid prejudgment and provide a fact-based report or recommendation within the agreed mandate."
            ]
        ]
    }
];

let selectedTemplateId = HM_TEMPLATES[0].id;

function hm(id) {
    return document.getElementById(id);
}

function clean(value, fallback) {
    const out = String(value || "").trim();
    return out || fallback;
}

function longDate(value) {
    if (!value) return "[EFFECTIVE DATE]";
    const d = new Date(value + "T12:00:00");
    return d.toLocaleDateString("en-JM", { year: "numeric", month: "long", day: "numeric" });
}

function formValues(templateMode) {
    if (templateMode) {
        return {
            companyName: "{{company_legal_name}}",
            productName: "{{product_or_business_name}}",
            partnerName: "{{partner_legal_name}}",
            partnerAddress: "{{partner_address}}",
            effectiveDate: "{{effective_date}}",
            term: "{{term}}",
            revenueShare: "{{revenue_share_percentage}}",
            paymentFrequency: "{{payment_frequency}}",
            revenueScope: "{{revenue_share_scope}}",
            paymentDueDays: "{{payment_due_days}}",
            terminationNotice: "{{termination_notice_days}}",
            expenseApproval: "{{expense_approval_threshold}}",
            tailPeriod: "{{post_termination_tail}}",
            relationshipType: hm("relationshipType").value,
            additionalDuties: "{{additional_duties}}"
        };
    }

    return {
        companyName: clean(hm("companyName").value, "iCreate Solutions & Services"),
        productName: clean(hm("productName").value, "HaloManage"),
        partnerName: clean(hm("partnerName").value, "[PARTNER FULL LEGAL NAME]"),
        partnerAddress: clean(hm("partnerAddress").value, "[PARTNER ADDRESS]"),
        effectiveDate: longDate(hm("effectiveDate").value),
        term: clean(hm("term").value, "[TERM]"),
        revenueShare: clean(hm("revenueShare").value, "[PERCENTAGE]"),
        paymentFrequency: clean(hm("paymentFrequency").value, "Monthly"),
        revenueScope: clean(hm("revenueScope").value, "[REVENUE SHARE SCOPE]"),
        paymentDueDays: clean(hm("paymentDueDays").value, "10"),
        terminationNotice: clean(hm("terminationNotice").value, "14"),
        expenseApproval: clean(hm("expenseApproval").value, "JMD $25,000"),
        tailPeriod: clean(hm("tailPeriod").value, "90 days"),
        relationshipType: hm("relationshipType").value,
        additionalDuties: hm("additionalDuties").value.trim()
    };
}

function lettered(items) {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    return items.map(function(item, index) {
        return "(" + (letters[index] || String(index + 1)) + ") " + item;
    }).join("\n");
}

function selectedTemplate() {
    return HM_TEMPLATES.find(function(t) { return t.id === selectedTemplateId; }) || HM_TEMPLATES[0];
}

function relationshipSection(t, v) {
    if (t.supportsFormal && v.relationshipType === "formal") {
        return [
            "2. FORMAL GENERAL PARTNERSHIP ELECTION",
            "",
            "2.1 Express intention. The parties expressly intend to carry on the " + v.productName + " business in common with a view to profit as a general partnership governed by the laws of Jamaica, subject to this Agreement and completed Schedule C.",
            "",
            "2.2 Written agreement controls. The parties intend this document and its schedules to record management, authority, contributions, profit and loss sharing, access to records, admission, withdrawal, dissociation, buyout and dissolution, subject to mandatory law.",
            "",
            "2.3 Partner status. Each party acknowledges that formal general-partner status may create agency powers, duties and personal exposure for partnership obligations. Internal authority is restricted by this Agreement, but third-party rights may also be affected by applicable partnership law.",
            "",
            "2.4 Condition before execution. Schedule C must be completed before this Agreement is signed as a formal general partnership. If Schedule C is materially incomplete, this template should not be executed as a formal partnership agreement."
        ].join("\n");
    }

    return [
        "2. COMMERCIAL RELATIONSHIP — NO EQUITY OR FORMAL PARTNERSHIP BY DEFAULT",
        "",
        "2.1 Appointment. The Company appoints the Partner as a commercial revenue-share collaborator for the role described in this Agreement. The word Partner is used as a commercial role title.",
        "",
        "2.2 No automatic equity. This Agreement does not grant shares, equity, voting rights, beneficial ownership, title to Company assets, ownership of " + v.productName + ", or a permanent right to Company profits.",
        "",
        "2.3 No formal general partnership intended. Unless a later written agreement expressly states otherwise and the parties deliberately implement that arrangement, the parties do not intend this Agreement by itself to create a formal general partnership, joint venture, employment relationship or unrestricted agency relationship.",
        "",
        "2.4 Conduct must match the agreement. The Partner shall not hold themselves out as an owner, shareholder, director, officer, legal general partner or person with unlimited authority to bind the Company.",
        "",
        "2.5 Compensation only. The revenue share in section 5 is contractual compensation for services. It is not a transfer of equity and does not, by itself, entitle the Partner to Company property, retained earnings, sale proceeds or revenue outside the agreed scope."
    ].join("\n");
}

function dutiesSection(t, v) {
    const duties = t.duties.slice();
    if (v.additionalDuties && v.additionalDuties !== "{{additional_duties}}") {
        v.additionalDuties.split("\n").forEach(function(line) {
            const item = line.trim();
            if (item) duties.push(item);
        });
    }

    return [
        "3. SERVICES, RESPONSIBILITIES AND PERFORMANCE STANDARDS",
        "",
        "3.1 Role. The Partner shall provide the services and carry out the responsibilities described in this Agreement and Schedule B in support of " + v.productName + ".",
        "",
        "3.2 Core responsibilities:",
        lettered(duties),
        "",
        "3.3 Performance standard. The Partner shall perform the services honestly, diligently, professionally, in good faith, within agreed timelines, and with the care reasonably expected from a competent person performing the relevant function.",
        "",
        "3.4 Reporting. The Partner shall keep reasonable records of material work, decisions, client or employee matters, approvals, financial matters and outstanding risks and shall provide the Company with the agreed reports and handover information.",
        "",
        "3.5 No undocumented authority. A responsibility to coordinate, advise, prepare, recommend, introduce, administer or support a matter does not by itself include authority to legally bind the Company, move funds, alter ownership, change compensation, dismiss personnel, promise commercial terms or sign a contract."
    ].join("\n");
}

function roleTermsSection(t) {
    const blocks = ["4. ROLE-SPECIFIC TERMS", ""];
    t.roleTerms.forEach(function(pair, index) {
        blocks.push("4." + (index + 1) + " " + pair[0].toUpperCase());
        blocks.push("");
        blocks.push(pair[1]);
        blocks.push("");
    });
    return blocks.join("\n").trim();
}

function revenueSection(v) {
    return [
        "5. REVENUE SHARE, EXPENSE DEDUCTIONS AND PAYMENT",
        "",
        "5.1 Percentage. Subject to this Agreement, the Partner shall be entitled to " + v.revenueShare + "% of Net Distributable Revenue within the Revenue Share Scope.",
        "",
        "5.2 Revenue Share Scope. The agreed scope is:",
        v.revenueScope,
        "",
        "No revenue outside this scope is included unless both parties record the change in writing.",
        "",
        "5.3 Collected Revenue. Collected Revenue means money actually received and cleared by the Company from customers within the Revenue Share Scope, including applicable subscription, implementation, onboarding, service, support, add-on, customization or consulting revenue attributable to " + v.productName + ". It excludes loans, owner funding, capital contributions, refundable deposits until earned, taxes collected solely for remittance, pass-through money held for a third party, and uncollected invoices unless Schedule A expressly adopts an accrual method.",
        "",
        "5.4 Permitted Business Expenses. Before calculating the Partner's percentage, the Company shall deduct legitimate, documented, ordinary and necessary business expenses attributable to operating, acquiring, developing, delivering, securing, marketing, supporting and administering " + v.productName + " or the agreed revenue pool. These may include:",
        lettered([
            "employee wages, salaries, commissions, benefits and statutory payroll costs;",
            "contractor, developer, designer, consultant and subcontractor fees;",
            "cloud hosting, databases, storage, domains, email, APIs, telecommunications and infrastructure;",
            "software subscriptions, licences, development tools, monitoring, cybersecurity and productivity tools;",
            "payment-processing, merchant, banking, foreign-exchange and transaction fees;",
            "advertising, approved commissions, sales tools, referral costs and customer-acquisition costs;",
            "customer support, onboarding, training and implementation costs;",
            "rent, utilities, equipment, insurance and ordinary administrative costs reasonably allocated to the revenue pool;",
            "professional accounting, tax, legal, compliance and advisory fees;",
            "refunds, credits, chargebacks and bona fide bad debts;",
            "taxes, levies, duties, licences and statutory charges borne by the business;",
            "approved travel, delivery, meeting and operating expenses; and",
            "other bona fide business expenses consistently recorded in the Company's books."
        ]),
        "",
        "5.5 Excluded deductions. Unless both parties expressly agree otherwise in writing, deductions shall not include personal or non-business expenses, owner drawings, dividends, distributions of capital, unexplained cash withdrawals, sham or materially above-market related-party charges, fines or penalties resulting from wilful misconduct, or an expense deliberately created or reclassified for the principal purpose of suppressing the Partner's revenue share.",
        "",
        "5.6 Extraordinary expenses. A single discretionary or non-routine expense above " + v.expenseApproval + " that materially affects the calculation shall be identified separately on the revenue-share statement. Disclosure does not give the Partner a veto over ordinary Company management unless Schedule A expressly provides an approval right.",
        "",
        "5.7 Net Distributable Revenue. Net Distributable Revenue equals Collected Revenue minus Permitted Business Expenses minus refunds, credits and chargebacks, plus or minus agreed prior-period adjustments. The Partner's payment equals Net Distributable Revenue multiplied by " + v.revenueShare + "%.",
        "",
        "5.8 No payment on a loss. If Net Distributable Revenue is zero or negative for a period, no revenue-share payment is due for that period. A negative balance shall not carry into a later period unless Schedule A expressly states otherwise.",
        "",
        "5.9 Payment cycle. Calculations shall be prepared " + v.paymentFrequency.toLowerCase() + " and any amount due shall be paid within " + v.paymentDueDays + " business days after the period closes and relevant receipts, refunds, expenses and processor settlements are reasonably reconciled.",
        "",
        "5.10 Statement. Each payment shall be accompanied by a statement showing, at minimum, Collected Revenue, material expense categories, total Permitted Business Expenses, Net Distributable Revenue, the applicable percentage, prior-period adjustments and the amount payable.",
        "",
        "5.11 Refunds and chargebacks. If revenue included in a prior calculation is later refunded, reversed, charged back or determined to have been received in error, the corresponding overpayment may be deducted from a later revenue-share payment. If no later payment becomes due within ninety (90) days, the parties shall agree a reasonable repayment arrangement.",
        "",
        "5.12 Taxes. The Partner is responsible for taxes and filings applicable to the Partner's own compensation except for any amount the Company is legally required to withhold or remit.",
        "",
        "5.13 Currency. Where revenue is received in a different currency, the Company shall use the actual processor or bank settlement amount where available, or otherwise a consistently applied exchange-rate source disclosed in Schedule A.",
        "",
        "5.14 Limited verification right. No more than once per calendar quarter, the Partner may request records reasonably sufficient to verify the relevant revenue-share calculation. The Company may redact unrelated customer information, payroll details, credentials, trade secrets and personal data. Any review remains confidential and shall not disrupt business operations.",
        "",
        "5.15 No minimum guarantee. Unless Schedule A states otherwise, this is variable compensation only. The Company does not guarantee any minimum revenue, profit, client count or revenue-share payment."
    ].join("\n");
}

function authoritySection(v) {
    return [
        "6. AUTHORITY, MANAGEMENT AND RESERVED MATTERS",
        "",
        "6.1 No implied power to bind. Except for authority expressly granted in writing, the Partner may not sign a customer, vendor, employment, financing or other contract; borrow money; guarantee debt; grant security; open or close an account; move Company funds; alter banking instructions; change pricing materially; issue a material refund; hire or dismiss personnel; change compensation; transfer material intellectual property; admit an owner or partner; sell a material Company asset; commence or settle material litigation; or make a public statement that reasonably appears to bind the Company.",
        "",
        "6.2 Reserved matters. Unless a completed formal-partnership schedule expressly states otherwise, ownership, equity, financing, bank mandates, tax elections, material capital expenditure, employment decisions, intellectual-property transfers, pricing policy, mergers, acquisitions, sale of " + v.productName + ", admission of owners and dissolution remain reserved to the Company.",
        "",
        "6.3 Approved expenses. The Partner shall not incur a reimbursable Company expense above the approval threshold in Schedule A without documented approval.",
        "",
        "6.4 Emergency protection. Nothing prevents a proportionate temporary action reasonably necessary to protect a person, data, credentials, Company funds or systems from an immediate threat, provided the Partner promptly notifies the Company and does not make an avoidable long-term commitment."
    ].join("\n");
}

function confidentialitySection(v) {
    return [
        "7. CONFIDENTIALITY, DATA PROTECTION AND SECURITY",
        "",
        "7.1 Confidential Information includes non-public business, customer, prospect, employee, candidate, supplier, pricing, product, software, source code, roadmap, credential, financial, payroll, tax, contract, strategy, security and operational information relating to the Company or " + v.productName + ".",
        "",
        "7.2 The Partner shall use Confidential Information only to perform this Agreement and shall disclose it only to an authorized person who needs it for the same purpose.",
        "",
        "7.3 The Partner shall apply reasonable physical, technical and organizational safeguards, including strong authentication, secure devices and approved storage locations.",
        "",
        "7.4 Credentials, banking data, payroll files, identity documents, employee records and customer data shall not be copied to personal accounts, forwarded to unauthorized persons or stored in unapproved systems.",
        "",
        "7.5 The Partner shall immediately report any suspected loss, unauthorized disclosure, account compromise, phishing event, malware incident, improper access or other security concern affecting Company information.",
        "",
        "7.6 Personal data shall be accessed and processed only for an authorized business purpose, only to the extent reasonably necessary, and in accordance with applicable Jamaican data-protection requirements and documented Company instructions.",
        "",
        "7.7 On request or termination, the Partner shall return Company property and securely delete Company information from personal systems, subject to records the Partner is legally required to retain.",
        "",
        "7.8 Confidentiality survives termination for five (5) years. Trade secrets, credentials and protected personal data remain protected for as long as the information remains confidential or the law requires."
    ].join("\n");
}

function ipSection(v) {
    return [
        "8. INTELLECTUAL PROPERTY, PRODUCT OWNERSHIP AND WORK PRODUCT",
        "",
        "8.1 Existing Company assets. The Company retains all rights in " + v.productName + ", including its name, software, source code, databases, architecture, designs, branding, domain names, customer lists, documentation, processes, roadmap, know-how and pre-existing materials except where a separate written instrument expressly states otherwise.",
        "",
        "8.2 New work product. To the fullest extent permitted by law, reports, policies, templates, analyses, procedures, workflows, code, designs, databases, documents, research, financial models, HR materials and other deliverables created specifically for the Company under this Agreement shall belong to the Company upon creation and payment for the relevant services.",
        "",
        "8.3 The Partner assigns to the Company all transferable rights in such work product and shall sign reasonable confirmatory documents if required.",
        "",
        "8.4 Pre-existing Partner tools and materials remain the Partner's property. If incorporated into a Company deliverable, the Partner grants the Company a perpetual, worldwide, royalty-free licence sufficient to use, maintain, modify and commercialize that deliverable.",
        "",
        "8.5 Access to code repositories, databases, dashboards, payment platforms, analytics, domains or systems is operational access only and does not create ownership."
    ].join("\n");
}

function conflictsSection(v) {
    return [
        "9. CLIENTS, BUSINESS OPPORTUNITIES, CONFLICTS AND NON-CIRCUMVENTION",
        "",
        "9.1 Clients, leads, suppliers, employees, contractors and opportunities introduced through Company systems, branding, marketing, contracts, personnel or Confidential Information remain Company business relationships unless Schedule A expressly states otherwise.",
        "",
        "9.2 During the Agreement and for twelve (12) months after termination, to the maximum extent lawful, the Partner shall not knowingly bypass the Company to privately contract for substantially the same HaloManage opportunity with a client or active prospect first introduced through the Company, unless the Company gives written consent.",
        "",
        "9.3 The Partner shall promptly disclose any actual or reasonably apparent conflict of interest, competing engagement, personal financial interest, referral fee, commission or side arrangement that could materially affect judgment.",
        "",
        "9.4 Nothing prevents the Partner from carrying on a lawful independent business that does not misuse Confidential Information or " + v.productName + " intellectual property, hold the Partner out as the Company, or interfere with an active Company engagement."
    ].join("\n");
}

function complianceAndLiability(v) {
    return [
        "10. COMPLIANCE, REPRESENTATIONS AND PROFESSIONAL CONDUCT",
        "",
        "10.1 Each party represents that it has authority to enter into this Agreement.",
        "",
        "10.2 The Partner shall comply with applicable laws, lawful Company policies communicated to the Partner, anti-bribery obligations, privacy and security requirements, and professional standards legally applicable to services personally undertaken.",
        "",
        "10.3 The Partner shall not knowingly make a false, misleading or unauthorized statement about the Company, " + v.productName + ", pricing, guarantees, product capability, financial condition, legal status, customers or employees.",
        "",
        "10.4 The Partner shall maintain any licence, certification, registration or professional standing legally required for services personally performed.",
        "",
        "11. LIABILITY AND INDEMNITY",
        "",
        "11.1 Each party remains responsible for its own fraud, wilful misconduct, gross negligence, unlawful acts and material breach.",
        "",
        "11.2 The Partner shall indemnify the Company against direct losses, third-party claims, penalties and reasonable professional costs arising from the Partner's fraud, wilful misconduct, unauthorized binding commitment, knowing misuse of Confidential Information, infringement caused by Partner-supplied material, or material violation of law.",
        "",
        "11.3 The Company shall indemnify the Partner against direct third-party claims arising solely from Company materials or instructions that the Partner followed in good faith and without knowledge that they were unlawful.",
        "",
        "11.4 Except for fraud, wilful misconduct, confidentiality or data-security breaches, intellectual-property infringement, unauthorized financial commitments or indemnity obligations, neither party shall be liable to the other for indirect, punitive, special or consequential loss or speculative future profit."
    ].join("\n");
}

function termAndEnding(t, v) {
    const lines = [
        "12. TERM, REVIEW, SUSPENSION AND TERMINATION",
        "",
        "12.1 Term. This Agreement begins on " + v.effectiveDate + ". The intended term is: " + v.term + ".",
        "",
        "12.2 Unless a role-specific fixed term states otherwise, either party may terminate without cause by giving " + v.terminationNotice + " days' written notice.",
        "",
        "12.3 The Company may terminate immediately for fraud, theft, deliberate dishonesty, material confidentiality or security breach, unauthorized financial activity, harassment, bribery, deliberate misrepresentation, abandonment of material duties, serious reputational misconduct, misuse of credentials, or another material breach that cannot reasonably be cured.",
        "",
        "12.4 For a curable material breach, the non-breaching party shall give written notice and allow seven (7) days to cure, unless immediate protective action is reasonably required to protect people, money, data, customers, systems or legal rights.",
        "",
        "12.5 The Company may temporarily restrict system, banking, payroll, customer, employee or code access while investigating a credible security, fraud, conflict, misconduct or authority concern.",
        "",
        "12.6 On termination or expiry, the Partner shall stop representing that the Partner has authority to act for the Company, return property, surrender credentials, provide outstanding records and complete a reasonable handover."
    ];
    if (t.id === "interim-general") {
        lines.push("");
        lines.push("12.7 Ninety-day expiry. The fixed assessment period takes priority over inconsistent renewal language. This Agreement ends automatically at the end of the ninety-day period unless a replacement agreement is signed.");
    }
    lines.push("");
    lines.push("13. POST-TERMINATION REVENUE AND FINAL ACCOUNT");
    lines.push("");
    lines.push("13.1 Properly earned amounts remain payable after termination subject to final reconciliation, refunds, chargebacks, prior overpayments and any lawful set-off.");
    lines.push("");
    lines.push("13.2 Unless a role-specific provision states otherwise, the post-termination revenue tail is " + v.tailPeriod + " and applies only to revenue or clients expressly described in Schedule A.");
    lines.push("");
    lines.push("13.3 No revenue-share right survives indefinitely unless this Agreement expressly says so. Termination ends authority to act for the Company immediately even where a limited revenue tail continues.");
    return lines.join("\n");
}

function generalTerms() {
    return [
        "14. DISPUTE RESOLUTION AND GOVERNING LAW",
        "",
        "14.1 A party raising a dispute shall give written notice summarizing the issue. The parties shall first attempt in good faith to resolve it through direct discussion within ten (10) business days.",
        "",
        "14.2 If unresolved, the parties shall attempt confidential mediation in Jamaica before ordinary court proceedings, unless urgent injunctive, protective, data-security, intellectual-property or debt-recovery relief is reasonably required.",
        "",
        "14.3 This Agreement is governed by the laws of Jamaica. Subject to the agreed dispute process, the courts of Jamaica shall have jurisdiction.",
        "",
        "15. NOTICES",
        "",
        "15.1 Formal notices may be sent by email to the notice addresses stated in Schedule A and, where appropriate, by courier or personal delivery to the stated physical address.",
        "",
        "15.2 An email notice is deemed received when transmitted without a delivery-failure notice, except that a termination or breach notice sent outside ordinary business hours is treated as received on the next business day.",
        "",
        "16. GENERAL CONTRACT TERMS",
        "",
        "16.1 Entire agreement. This Agreement and its schedules constitute the entire agreement on this subject and replace prior discussions, messages and informal understandings concerning the same role and revenue share.",
        "",
        "16.2 Written amendments. No change to the revenue-share percentage, Revenue Share Scope, ownership, authority, term, formal partnership status or reserved matters is effective unless recorded in writing and accepted by both parties.",
        "",
        "16.3 No waiver. Failure to enforce a provision on one occasion is not a waiver.",
        "",
        "16.4 Severability. If a provision is held invalid or unenforceable, it shall be narrowed to the minimum extent legally necessary and the remaining provisions shall continue.",
        "",
        "16.5 Assignment. The Partner may not assign or subcontract material duties without written approval. The Company may assign this Agreement as part of a bona fide restructuring, transfer or sale of the relevant business, subject to accrued payment rights.",
        "",
        "16.6 Counterparts and electronic acceptance. This Agreement may be signed in counterparts and may be accepted by an agreed electronic-signature process. Each signed counterpart forms part of one instrument.",
        "",
        "16.7 Independent advice. Each party confirms that it has had a reasonable opportunity to obtain independent legal, tax and financial advice before signing.",
        "",
        "16.8 Headings are for convenience and do not limit interpretation."
    ].join("\n");
}

function formalSchedule(v) {
    return [
        "SCHEDULE C — FORMAL GENERAL PARTNERSHIP TERMS",
        "Complete this schedule only if formal general-partnership status is deliberately selected.",
        "",
        "1. Firm / partnership name: " + v.productName + " Partnership / {{formal_partnership_name}}",
        "2. Principal place of business: {{principal_place_of_business}}",
        "3. Company/founder capital contribution: {{company_capital_contribution}}",
        "4. Partner capital contribution: {{partner_capital_contribution}}",
        "5. Partnership interests: {{partnership_interest_split}}",
        "6. Profit-sharing ratio: {{formal_profit_share}}",
        "7. Loss-sharing ratio: {{formal_loss_share}}",
        "8. Drawings / distributions policy: {{distribution_policy}}",
        "9. Ordinary management authority: {{ordinary_management_authority}}",
        "10. Banking authority: {{formal_banking_authority}}",
        "11. Spending authority: {{formal_spending_authority}}",
        "12. Reserved matters requiring unanimous written consent: borrowing or granting security; admission of a new partner; change to ownership or profit/loss ratios; sale of substantially all assets; material intellectual-property transfer; merger or conversion; material capital expenditure outside the approved budget; change to bank mandate; dissolution or winding up; and {{additional_reserved_matters}}.",
        "13. Books and records. Each partner shall have reasonable access to partnership books and records subject to privacy and security controls.",
        "14. Partner duties. Each partner shall comply with the duties and standards imposed by applicable Jamaican partnership law and this Agreement, including applicable duties of loyalty, care, good faith and fair dealing.",
        "15. New partners. No new partner may be admitted without unanimous written consent and a signed accession agreement.",
        "16. Voluntary withdrawal / dissociation: {{withdrawal_rules}}",
        "17. Death, incapacity, insolvency or disqualification: {{continuity_rules}}",
        "18. Buyout valuation method: {{buyout_method}}",
        "19. Payment of buyout: {{buyout_payment_terms}}",
        "20. Dissolution / winding up procedure: {{dissolution_process}}",
        "21. Registration / filing responsibility: {{registration_responsibility}}",
        "22. Partnership tax and accounting responsibility: {{formal_partnership_accounting}}"
    ].join("\n");
}

function schedules(t, v) {
    const relationship = t.supportsFormal && v.relationshipType === "formal"
        ? "Formal general partnership — Schedule C must be completed"
        : "Commercial revenue-share collaborator; no equity or formal partnership by default";

    const a = [
        "SCHEDULE A — COMMERCIAL TERMS",
        "",
        "Company / owner entity: " + v.companyName,
        "Product / business: " + v.productName,
        "Partner legal name: " + v.partnerName,
        "Partner address: " + v.partnerAddress,
        "Effective date: " + v.effectiveDate,
        "Role / agreement: " + t.title,
        "Term: " + v.term,
        "Revenue-share percentage: " + v.revenueShare + "%",
        "Revenue Share Scope: " + v.revenueScope,
        "Payment frequency: " + v.paymentFrequency,
        "Payment due: " + v.paymentDueDays + " business days after close and reconciliation",
        "Extraordinary-expense disclosure threshold: " + v.expenseApproval,
        "Termination notice: " + v.terminationNotice + " days",
        "Post-termination revenue tail: " + v.tailPeriod,
        "Legal relationship: " + relationship,
        "Company notice email: {{company_notice_email}}",
        "Partner notice email: {{partner_notice_email}}",
        "Primary Company decision-maker: {{company_decision_maker}}",
        "Required insurance, if any: {{insurance_requirements}}",
        "",
        "SCHEDULE B — ROLE DETAILS",
        "",
        "Primary responsibilities: See section 3.",
        "Additional duties / deliverables:",
        v.additionalDuties || "{{additional_duties_or_deliverables}}",
        "",
        "Systems / data access: {{systems_and_data_access}}",
        "Decisions Partner may make alone: {{delegated_decisions}}",
        "Decisions requiring Company approval: {{approval_required_decisions}}",
        "Reporting cadence: {{reporting_cadence}}",
        "Key performance expectations: {{performance_expectations}}",
        "Expense reimbursement rules: {{expense_reimbursement_rules}}",
        "Other exclusions or limitations: {{role_exclusions}}"
    ];

    if (t.supportsFormal && v.relationshipType === "formal") {
        a.push("");
        a.push(formalSchedule(v));
    }

    a.push("");
    a.push("SIGNATURES");
    a.push("");
    a.push("For " + v.companyName);
    a.push("Name: {{company_signatory_name}}");
    a.push("Title: {{company_signatory_title}}");
    a.push("Signature: ______________________________");
    a.push("Date: __________________________________");
    a.push("");
    a.push("Partner");
    a.push("Name: " + v.partnerName);
    a.push("Signature: ______________________________");
    a.push("Date: __________________________________");
    a.push("");
    a.push("Witness (if used)");
    a.push("Name: __________________________________");
    a.push("Signature: ______________________________");
    a.push("Date: __________________________________");

    return a.join("\n");
}

function buildContract(t, v) {
    return [
        t.title.toUpperCase(),
        "",
        "This Agreement is made as of " + v.effectiveDate + " between:",
        "",
        "(1) " + v.companyName + ", the owner/operator of the " + v.productName + " business and product (Company); and",
        "",
        "(2) " + v.partnerName + ", of " + v.partnerAddress + " (Partner).",
        "",
        "The Company and Partner are together referred to as the Parties.",
        "",
        "1. PURPOSE AND BUSINESS CONTEXT",
        "",
        "1.1 The Company is developing, operating and commercializing " + v.productName + ". The Company wishes to engage the Partner to contribute specialized services, business development, administration, management support or professional expertise according to the selected role.",
        "",
        "1.2 The Partner will receive contractual revenue-share compensation calculated only after the deductions and reconciliation described in section 5.",
        "",
        "1.3 The Parties intend this written Agreement to define responsibilities, authority, confidentiality, product ownership, payment rights, reporting, risk allocation, termination and the legal nature of their relationship.",
        "",
        relationshipSection(t, v),
        "",
        dutiesSection(t, v),
        "",
        roleTermsSection(t),
        "",
        revenueSection(v),
        "",
        authoritySection(v),
        "",
        confidentialitySection(v),
        "",
        ipSection(v),
        "",
        conflictsSection(v),
        "",
        complianceAndLiability(v),
        "",
        termAndEnding(t, v),
        "",
        generalTerms(),
        "",
        schedules(t, v)
    ].join("\n");
}

function renderTemplateCards() {
    const root = hm("templateList");
    root.innerHTML = "";
    HM_TEMPLATES.forEach(function(t) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hm-template-card" + (t.id === selectedTemplateId ? " active" : "");
        button.innerHTML =
            "<strong>" + escapeHtml(t.shortTitle) + "</strong>" +
            "<small>" + escapeHtml(t.summary) + "</small>" +
            "<span class=\"hm-tag\">" + escapeHtml(t.tag) + "</span>";
        button.addEventListener("click", function() { selectTemplate(t.id); });
        root.appendChild(button);
    });
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderPreview() {
    hm("contractPreview").textContent = buildContract(selectedTemplate(), formValues(false));
}

function selectTemplate(id) {
    selectedTemplateId = id;
    const t = selectedTemplate();
    hm("templateTitle").textContent = t.title;
    hm("templateSummary").textContent = t.summary;
    hm("term").value = t.term;
    hm("revenueScope").value = t.scope;
    hm("tailPeriod").value = t.tail;
    hm("relationshipTypeWrap").style.display = t.supportsFormal ? "" : "none";
    if (!t.supportsFormal) hm("relationshipType").value = "commercial";
    renderTemplateCards();
    renderPreview();
}

async function copyText(content, successMessage) {
    try {
        await navigator.clipboard.writeText(content);
    } catch (err) {
        const area = document.createElement("textarea");
        area.value = content;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
    }
    if (window.showAlert) await window.showAlert(successMessage, "success");
}

function downloadFilledContract() {
    const t = selectedTemplate();
    const text = buildContract(t, formValues(false));
    const slug = t.shortTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "halomanage-" + slug + ".txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function initHaloManageContracts() {
    const now = new Date();
    hm("effectiveDate").value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    [
        "companyName", "productName", "partnerName", "partnerAddress", "effectiveDate",
        "term", "revenueShare", "paymentFrequency", "revenueScope", "paymentDueDays",
        "terminationNotice", "expenseApproval", "tailPeriod", "relationshipType", "additionalDuties"
    ].forEach(function(id) {
        hm(id).addEventListener("input", renderPreview);
        hm(id).addEventListener("change", renderPreview);
    });

    hm("copyFilledBtn").addEventListener("click", function() {
        copyText(buildContract(selectedTemplate(), formValues(false)), "Filled HaloManage contract copied.");
    });

    hm("copyTemplateBtn").addEventListener("click", function() {
        copyText(buildContract(selectedTemplate(), formValues(true)), "Reusable contract template copied with placeholders.");
    });

    hm("downloadBtn").addEventListener("click", downloadFilledContract);

    selectTemplate(selectedTemplateId);
}

document.addEventListener("DOMContentLoaded", initHaloManageContracts);
