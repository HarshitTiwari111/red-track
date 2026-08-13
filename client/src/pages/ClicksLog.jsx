import { useCallback, useEffect, useRef, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { campaignsApi, logsApi, errMsg } from '../api/client.js';

const time = (ts) => new Date(ts).toLocaleString();

export default function ClicksLog() {
  const [items, setItems] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [filters, setFilters] = useState({ campaignId: '', country: '', bot: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(true);
  const [detail, setDetail] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    campaignsApi.list().then(setCampaigns).catch(() => {});
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = { limit: 500 };
      const f = filtersRef.current;
      if (f.campaignId) params.campaignId = f.campaignId;
      if (f.country) params.country = f.country;
      if (f.bot !== '') params.bot = f.bot;
      setItems(await logsApi.clicks(params));
      setError('');
    } catch (err) {
      setError(errMsg(err, 'Could not load clicks'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, filters]);

  // Live refresh every 10 seconds
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => load(true), 10_000);
    return () => clearInterval(t);
  }, [auto, load]);

  const openDetail = async (row) => {
    try {
      setDetail(await logsApi.click(row.clickid));
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const columns = [
    { key: 'ts', label: 'Time', render: (r) => <span className="nowrap">{time(r.ts)}</span> },
    { key: 'clickid', label: 'Click ID', render: (r) => <span className="mono">{r.clickid}</span> },
    { key: 'campaignName', label: 'Campaign', render: (r) => r.campaignName || '—' },
    { key: 'country', label: 'Geo', sortValue: (r) => r.geo?.country, render: (r) => `${r.geo?.country || 'XX'}${r.geo?.city ? ` · ${r.geo.city}` : ''}` },
    { key: 'device', label: 'Device', sortValue: (r) => r.uaParsed?.device, render: (r) => `${r.uaParsed?.device || '—'} / ${r.uaParsed?.os || '—'}` },
    { key: 'browser', label: 'Browser', sortValue: (r) => r.uaParsed?.browser, render: (r) => r.uaParsed?.browser || '—' },
    { key: 'sub1', label: 'Sub1', render: (r) => <span className="mono truncate" style={{ maxWidth: 140 }}>{r.sub1 || '—'}</span> },
    { key: 'cost', label: 'Cost', num: true, render: (r) => Number(r.cost || 0).toFixed(4) },
    {
      key: 'flags',
      label: 'Flags',
      noSort: true,
      render: (r) => (
        <>
          {r.botFlag && <span className="badge bot">bot</span>}{' '}
          {r.lpClick && <span className="badge neutral">LP</span>}{' '}
          {r.converted && <span className="badge approved">conv</span>}
        </>
      ),
    },
  ];

  return (
    <Page
      title="Clicks Log"
      actions={
        <>
          <label className="dim" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            auto-refresh 10s
          </label>
          <button type="button" className="btn sm" onClick={() => load()}>
            {loading ? <span className="spinner" /> : '↻'} Refresh
          </button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}

      <div className="toolbar">
        <select value={filters.campaignId} onChange={(e) => setFilters({ ...filters, campaignId: e.target.value })}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Country (IN)"
          value={filters.country}
          onChange={(e) => setFilters({ ...filters, country: e.target.value.toUpperCase() })}
          style={{ width: 130 }}
        />
        <select value={filters.bot} onChange={(e) => setFilters({ ...filters, bot: e.target.value })}>
          <option value="">Humans + bots</option>
          <option value="false">Humans only</option>
          <option value="true">Bots only</option>
        </select>
        <span className="mute" style={{ fontSize: 12 }}>
          showing last {items.length} clicks
        </span>
      </div>

      <div className="panel">
        <DataTable columns={columns} rows={items} loading={loading} rowKey={(r) => r.clickid} onRowClick={openDetail} />
      </div>

      {detail && (
        <Modal wide title={`Click ${detail.click.clickid}`} onClose={() => setDetail(null)}>
          <div className="field-row">
            <div>
              <div className="section-title">Click</div>
              <table className="data">
                <tbody>
                  {[
                    ['Time', time(detail.click.ts)],
                    ['Campaign', detail.click.campaignName],
                    ['IP', detail.click.ip],
                    ['Geo', `${detail.click.geo?.country} ${detail.click.geo?.region} ${detail.click.geo?.city}`],
                    ['Device', `${detail.click.uaParsed?.device} / ${detail.click.uaParsed?.os} / ${detail.click.uaParsed?.browser}`],
                    ['Entry', detail.click.entry],
                    ['Path index', detail.click.pathIndex],
                    ['Lander', detail.click.landerName || '—'],
                    ['Offer', detail.click.offerName || '—'],
                    ['Cost', detail.click.cost],
                    ['Bot', String(detail.click.botFlag)],
                    ['LP click', String(detail.click.lpClick)],
                    ['Referer', detail.click.referer || '—'],
                    ['gclid', detail.click.gclid || '—'],
                    ['fbclid', detail.click.fbclid || '—'],
                    ['ttclid', detail.click.ttclid || '—'],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td className="dim">{k}</td>
                      <td className="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="section-title">Subs</div>
              <table className="data">
                <tbody>
                  {Array.from({ length: 10 }, (_, i) => `sub${i + 1}`).map((s) => (
                    <tr key={s}>
                      <td className="dim">{s}</td>
                      <td className="mono">{detail.click[s] || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="section-title" style={{ marginTop: 16 }}>
                Conversions ({detail.conversions.length})
              </div>
              {detail.conversions.length === 0 ? (
                <div className="mute">No conversions for this click.</div>
              ) : (
                <table className="data">
                  <tbody>
                    {detail.conversions.map((c) => (
                      <tr key={c._id}>
                        <td>{time(c.ts)}</td>
                        <td className="mono">{c.txid || '—'}</td>
                        <td>{c.type}</td>
                        <td className="num">{Number(c.payout).toFixed(2)}</td>
                        <td>
                          <span className={`badge ${c.status}`}>{c.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="section-title" style={{ marginTop: 16 }}>
            Final URL
          </div>
          <div className="mono" style={{ wordBreak: 'break-all' }}>
            {detail.click.finalUrl || '—'}
          </div>

          <div className="section-title" style={{ marginTop: 16 }}>
            User agent
          </div>
          <div className="mono mute" style={{ wordBreak: 'break-all' }}>
            {detail.click.ua || '—'}
          </div>
        </Modal>
      )}
    </Page>
  );
}
