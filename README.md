# JV Handbook System

Two pages over the `JV Handbook System` Airtable base (`appjppIU9ZEi611Qj`).

| Path | File | Who it's for |
|---|---|---|
| `/register` | `index.html` | International Resources — oversight. All 104 master sections, classification, full text, what needs attention. |
| `/build` | `builder.html` | Country teams — pick the sections for their handbook, then edit them. |

Both pages currently run on **data embedded at build time**, so they work standalone with no setup. The serverless function below is what makes them live.

---

## 1. Push to GitHub

```bash
cd <this folder>
git init
git add .
git commit -m "JV handbook register and country builder"
git branch -M main
git remote add origin https://github.com/<org>/jv-handbook-system.git
git push -u origin main
```

## 2. Deploy on Netlify

1. Netlify → **Add new site** → **Import an existing project** → pick the repo.
2. Build command: leave empty. Publish directory: `.` (already set in `netlify.toml`).
3. Deploy.

## 3. Add the Airtable token

Airtable → **Developer hub** → **Personal access tokens** → create one with:

- Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`
- Access: the **JV Handbook System** base only

Then in Netlify → **Site configuration** → **Environment variables**:

```
AIRTABLE_TOKEN = pat...
```

Redeploy so the function picks it up.

## 4. Check it works

```
https://<your-site>.netlify.app/api?action=sections
```

Should return 104 sections. If it returns `AIRTABLE_TOKEN is not set`, the variable didn't reach the build — redeploy.

---

## The API

| Call | Returns |
|---|---|
| `GET /api?action=sections` | All master sections: number, title, chapter, classification, master text |
| `GET /api?action=country&name=Czech%20Republic` | That country's section records: local text, status, disposition |
| `POST /api?action=save` | Saves country edits. Body: `{"records":[{"id":"rec…","fields":{"fldWQiLyTXMTi0ona":"…"}}]}` |

The function is **not** a general passthrough. It permits three operations against fixed tables, and writes are restricted to a four-field whitelist (Local Text, Status, Disposition, Response Notes). Master text and classification cannot be written from the browser. Keep it that way — a general proxy would let anyone with the site URL rewrite the base.

---

## Making the pages live

Both pages define their data as a constant near the top of the `<script>` block:

- `index.html` → `const DATA = [...]`
- `builder.html` → `const SEC = [...]`

To switch to live data, replace the constant with a fetch and call the existing render function afterwards:

```js
let DATA = [];
(async () => {
  const r = await fetch('/api?action=sections');
  const j = await r.json();
  DATA = j.sections.map(s => ({
    no: s.no,
    title: s.title,
    chap: s.chap,
    tier: {Universal:1, Tweaks:2, 'All National':3, 'US Annex':0}[s.classification || s.proposed] ?? 2,
    status: 'Current',
    note: s.notes || '',
    text: s.text
  }));
  draw();           // builder.html
  // render();      // index.html
})();
```

Keep the embedded array as a fallback if you want the pages to survive an Airtable outage.

### Saving from the builder

`builder.html` currently holds edits in memory only. To persist, add a save call that posts changed sections:

```js
async function save(changed) {
  await fetch('/api?action=save', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      records: changed.map(c => ({
        id: c.recordId,                          // from ?action=country
        fields: { 'fldWQiLyTXMTi0ona': c.txt }   // Local Text
      }))
    })
  });
}
```

This needs the country's record IDs, so load `?action=country&name=…` when the country selector changes and keep the mapping from section number to record ID.

---

## Access control

There is none yet. Anyone with the URL can read and — once saving is wired — write.

Options, cheapest first:

1. **Netlify password protection** — one shared password, site-wide. Fine for a pilot.
2. **Netlify Identity** — per-person logins, free tier covers your numbers.
3. **Per-country links** — a signed token in the URL that scopes the builder to one country. Prevents Poland editing Czech records.

Do at least one of these before sending the link to country teams.

---

## Notes

- Section numbering is the spine of the whole system. `3.4.b` is maternity leave in every country. Don't renumber.
- Classifications are **Universal**, **Tweaks**, **All National**, plus **US Annex**. The `Classification` field is HR's decision; `Proposed Classification` is the migration's suggestion and should not drive anything.
- Editing a Universal section is recorded as a departure rather than blocked.
- Section 2.16 (Child and Youth Protection) is a specification, not a policy. It must be written and approved before any country handbook is published.
