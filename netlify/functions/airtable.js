// Airtable proxy for the JV Handbook System.
//
// The Airtable token NEVER reaches the browser. It lives in the AIRTABLE_TOKEN
// environment variable on Netlify and is only used server-side here.
//
// This is deliberately NOT a general passthrough. Only the operations below are
// permitted, against a fixed base, fixed tables and a fixed field whitelist.
// A general proxy would let anyone with the site URL read and rewrite the base.

const BASE = 'appjppIU9ZEi611Qj';

const TBL = {
  sections: 'tblrhfA8W2uvqn34e',
  countries: 'tblP78kWcOs5FRLgK',
  countrySections: 'tbl1U6ke46U8TW3Je',
};

// Only these fields may ever be written back from the browser.
const WRITABLE = new Set([
  'fldWQiLyTXMTi0ona', // Local Text
  'fldOKq65VaKVmKz1s', // Status
  'fld4iVv23O3GpwyM0', // Disposition
  'fldvovsaREXWXnFqU', // Response Notes
]);

const api = async (path, opts = {}) => {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
};

// Page through a table, following Airtable's offset cursor.
const listAll = async (tableId, params = {}) => {
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: '100', ...params });
    if (offset) q.set('offset', offset);
    const page = await api(`${tableId}?${q}`);
    out.push(...page.records);
    offset = page.offset;
  } while (offset);
  return out;
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (!process.env.AIRTABLE_TOKEN) {
    return json(500, { error: 'AIRTABLE_TOKEN is not set on this deploy.' });
  }

  try {
    const action = (event.queryStringParameters || {}).action;

    // ---- READ: master sections -------------------------------------------
    if (event.httpMethod === 'GET' && action === 'sections') {
      const recs = await listAll(TBL.sections);
      return json(200, {
        sections: recs.map((r) => ({
          id: r.id,
          no: r.fields['Section Number'],
          title: r.fields['Title'],
          chap: r.fields['Chapter'],
          proposed: r.fields['Proposed Classification'],
          classification: r.fields['Classification'],
          reviewedBy: r.fields['Reviewed By'],
          text: r.fields['Master Text'] || '',
          notes: r.fields['Notes'] || '',
        })),
      });
    }

    // ---- READ: one country's section records ------------------------------
    if (event.httpMethod === 'GET' && action === 'country') {
      const name = (event.queryStringParameters || {}).name || '';
      if (!/^[A-Za-z .'-]{2,40}$/.test(name)) {
        return json(400, { error: 'Bad country name.' });
      }
      // Escape quotes before interpolating into the Airtable formula.
      const safe = name.replace(/'/g, "\\'");
      // Fetch the country's junction records and the master sections in parallel,
      // so we can resolve each record's Section link (a record id) to its number.
      const [secs, recs] = await Promise.all([
        listAll(TBL.sections),
        listAll(TBL.countrySections, {
          filterByFormula: `FIND('${safe}', ARRAYJOIN({Country}))`,
        }),
      ]);
      const numById = {};
      for (const s of secs) numById[s.id] = s.fields['Section Number'];
      return json(200, {
        country: name,
        records: recs.map((r) => {
          const link = r.fields['Section'];
          return {
            id: r.id,
            no: (link && link[0] && numById[link[0]]) || null,
            key: r.fields['Key'],
            localText: r.fields['Local Text'] || '',
            status: r.fields['Status'],
            disposition: r.fields['Disposition'],
            notes: r.fields['Response Notes'] || '',
          };
        }),
      });
    }

    // ---- WRITE: save a country's edits ------------------------------------
    if (event.httpMethod === 'POST' && action === 'save') {
      const body = JSON.parse(event.body || '{}');
      const updates = Array.isArray(body.records) ? body.records : [];
      if (!updates.length) return json(400, { error: 'No records supplied.' });
      if (updates.length > 200) return json(400, { error: 'Too many records in one call.' });

      // Strip anything not on the whitelist before it reaches Airtable.
      const clean = updates.map((u) => {
        const fields = {};
        for (const [k, v] of Object.entries(u.fields || {})) {
          if (WRITABLE.has(k)) fields[k] = v;
        }
        return { id: u.id, fields };
      });
      const rejected = clean.filter((c) => !Object.keys(c.fields).length).length;

      // Airtable accepts a maximum of 10 records per PATCH.
      const saved = [];
      for (let i = 0; i < clean.length; i += 10) {
        const chunk = clean.slice(i, i + 10).filter((c) => Object.keys(c.fields).length);
        if (!chunk.length) continue;
        const res = await api(TBL.countrySections, {
          method: 'PATCH',
          body: JSON.stringify({ records: chunk }),
        });
        saved.push(...res.records.map((r) => r.id));
      }
      return json(200, { saved: saved.length, rejected });
    }

    return json(400, { error: 'Unknown action. Use ?action=sections, ?action=country&name=…, or POST ?action=save' });
  } catch (err) {
    return json(502, { error: String(err.message || err) });
  }
};
