// CC copies contain an attachment, never the signer's bearer link.
function normalizeContractCc(value, signerEmail) {
  if (value == null || value === '') return [];
  if (typeof value !== 'string' && !Array.isArray(value)) throw new Error('CC must be email addresses separated by commas.');
  const values = (Array.isArray(value) ? value : value.split(/[,;]/)).map(v => {
    if (typeof v !== 'string') throw new Error('Every CC recipient must be an email address.');
    const email = v.trim().toLowerCase();
    if (email && (email.length > 254 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email))) throw new Error('Enter valid CC email addresses, without names or line breaks.');
    return email;
  }).filter(Boolean);
  const unique = [...new Set(values)].filter(v => v !== String(signerEmail || '').trim().toLowerCase());
  if (unique.length > 5) throw new Error('Add no more than five CC recipients.');
  return unique;
}
function referenceCopyTemplate(contract) {
  const safe = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ref = contract.agreement_reference || 'Service Agreement';
  const text = `Good day,\n\nPlease find the agreement for ${contract.business_name || contract.client_name} attached for your reference (${ref}). The signing invitation is sent separately to the designated client only. This reference copy does not grant signing authority.\n\nShamar Baker\niCreate Solutions & Services\nicreatesolutionsandservices.com`;
  return {subject:`Reference copy: ${ref}`,text,html:`<div style="font-family:Arial,sans-serif;background:#f1f5f9;padding:28px"><div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden"><div style="background:#0b2447;color:white;padding:24px"><h2 style="margin:0">Agreement reference copy</h2><p>${safe(ref)}</p></div><div style="padding:24px"><p>Good day,</p><p>Please find the agreement for <strong>${safe(contract.business_name || contract.client_name)}</strong> attached for your reference.</p><p>The signing invitation is sent separately to the designated client only. This reference copy does not grant signing authority.</p><p>Shamar Baker<br>iCreate Solutions &amp; Services<br>icreatesolutionsandservices.com</p></div></div></div>`};
}
module.exports = { normalizeContractCc, referenceCopyTemplate };
