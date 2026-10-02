import { useEffect, useState } from 'react';
import {
  api,
  formatMoney,
  uploadProductImage,
  uploadDigitalFile,
  type Category,
  type DeliveryType,
  type PastelColor,
  type Product,
  type ProductWriteBody,
} from '../../lib/api';
import { PASTEL_HEX } from '../../components/PastelThumb';
import { useToast } from '../../context/ToastContext';

const COLORS: PastelColor[] = ['blue', 'pink', 'yellow', 'mint'];
const DELIVERY: { id: DeliveryType; label: string }[] = [
  { id: 'physical', label: 'Physical (ships)' },
  { id: 'digital', label: 'Digital (file download)' },
  { id: 'none', label: 'No delivery (service / access)' },
];

type FormState = {
  name: string;
  description: string;
  price: string;
  stock: string;
  category_id: string;
  pastel_color: PastelColor;
  image_url: string;
  active: boolean;
  delivery_type: DeliveryType;
  digital_file_path: string;
};

const emptyForm = (): FormState => ({
  name: '', description: '', price: '', stock: '10', category_id: '',
  pastel_color: 'blue', image_url: '', active: true, delivery_type: 'physical',
  digital_file_path: '',
});

export function Products() {
  const toast = useToast();
  const [items, setItems] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currency, setCurrency] = useState('$');
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const load = () =>
    Promise.all([api.products({ all: true }), api.categories(), api.store()])
      .then(([p, c, s]) => {
        setItems(p.products);
        setCategories(c.categories);
        setCurrency(s.store.currency_symbol);
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Load failed'));

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setFormOpen(true); };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description ?? '',
      price: String(p.price),
      stock: String(p.stock),
      category_id: p.category_id ?? '',
      pastel_color: p.pastel_color,
      image_url: p.image_url ?? '',
      active: p.active,
      delivery_type: p.delivery_type,
      digital_file_path: p.digital_file_path ?? '',
    });
    setFormOpen(true);
  };

  const onImageFile = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadProductImage(file);
      setForm((f) => ({ ...f, image_url: url }));
      toast('Image uploaded');
    } catch (err) { toast(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setUploading(false); }
  };

  const onDigitalFile = async (file: File) => {
    setUploadingFile(true);
    try {
      const path = await uploadDigitalFile(file);
      setForm((f) => ({ ...f, digital_file_path: path }));
      toast('File uploaded');
    } catch (err) { toast(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setUploadingFile(false); }
  };

  const save = async () => {
    const price = Number(form.price);
    const stock = Number(form.stock);
    if (!form.name.trim()) return toast('Product needs a name');
    if (!Number.isFinite(price) || price < 0) return toast('Enter a valid price');
    if (form.delivery_type === 'physical' && (!Number.isInteger(stock) || stock < 0)) return toast('Enter valid stock');
    if (form.delivery_type === 'digital' && !form.digital_file_path) return toast('Upload a digital file first');

    const body: ProductWriteBody = {
      name: form.name.trim(),
      description: form.description.trim(),
      price,
      stock: form.delivery_type === 'physical' ? stock : 0,
      category_id: form.category_id || null,
      pastel_color: form.pastel_color,
      image_url: form.image_url || null,
      active: form.active,
      delivery_type: form.delivery_type,
      digital_file_path: form.digital_file_path || null,
    };

    setBusy(true);
    try {
      if (editingId) { await api.updateProduct(editingId, body); toast('Product updated'); }
      else { await api.createProduct({ ...body, name: form.name.trim(), price }); toast('Product published'); }
      setFormOpen(false);
      await load();
    } catch (err) { toast(err instanceof Error ? err.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  const toggleActive = async (p: Product) => {
    try { await api.updateProduct(p.id, { active: !p.active }); await load();
      toast(p.active ? `“${p.name}” hidden` : `“${p.name}” visible`);
    } catch (err) { toast(err instanceof Error ? err.message : 'Update failed'); }
  };

  const removeProduct = async (p: Product) => {
    if (!window.confirm(`Deactivate “${p.name}”?`)) return;
    try { await api.deleteProduct(p.id); await load(); toast('Deactivated'); }
    catch (err) { toast(err instanceof Error ? err.message : 'Failed'); }
  };

  if (!items) return <p className="muted" style={{ marginTop: 16 }}>Loading…</p>;

  return (
    <>
      <div className="inv-list">
        {items.map((p) => (
          <div className="inv-row" key={p.id} style={{ flexWrap: 'wrap' }}>
            <div className="inv-thumb" style={{ background: PASTEL_HEX[p.pastel_color] }}>
              {p.image_url ? <img src={p.image_url} alt={p.name} /> : <span className="initial">{p.name.charAt(0).toUpperCase()}</span>}
            </div>
            <div className="inv-info">
              <div className="inv-name">{p.name}</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                {formatMoney(p.price, currency)} · {p.delivery_type === 'physical' ? `${p.stock} in stock` : p.delivery_type === 'digital' ? 'Digital' : 'No delivery'}
              </div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={p.active} onChange={() => toggleActive(p)} />
              <span className="track" /><span className="knob" />
            </label>
          </div>
        ))}
        {items.length === 0 && (
          <div className="inv-row"><div className="inv-info muted">No products yet.</div></div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="dashed-btn" style={{ marginTop: 0 }} onClick={openNew}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add product
        </button>
      </div>

      {items.length > 0 && (
        <div className="inv-list" style={{ marginTop: 12 }}>
          {items.map((p) => (
            <div className="inv-row" key={`${p.id}-actions`}>
              <div className="inv-info"><div className="inv-name">{p.name}</div></div>
              <button type="button" className="link-btn" onClick={() => openEdit(p)}>Edit</button>
              <button type="button" className="link-btn" onClick={() => removeProduct(p)}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="modal-back" onClick={() => !busy && setFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingId ? 'Edit product' : 'New product'}</h3>

            <div className="field">
              <label>Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Oak Desk Tray" />
            </div>

            <div className="field">
              <label>Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
            </div>

            <div className="field">
              <label>Delivery</label>
              <select value={form.delivery_type} onChange={(e) => setForm({ ...form, delivery_type: e.target.value as DeliveryType })}>
                {DELIVERY.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
              </select>
            </div>

            {form.delivery_type === 'digital' && (
              <div className="field">
                <label>Digital file</label>
                {!form.digital_file_path ? (
                  <input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onDigitalFile(f); }} disabled={uploadingFile} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--chip)' }}>
                    <span className="muted" style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono', monospace" }}>
                      {form.digital_file_path.slice(0, 40)}…
                    </span>
                    <button type="button" className="x-btn" aria-label="Remove file" onClick={() => setForm({ ...form, digital_file_path: '' })}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <label>Price</label>
                <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              {form.delivery_type === 'physical' && (
                <div className="field">
                  <label>Stock</label>
                  <input type="number" min="0" step="1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                </div>
              )}
            </div>

            <div className="field">
              <label>Category</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">No category</option>
                {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>

            <div className="field">
              <label>Backdrop</label>
              <div className="swatches">
                {COLORS.map((c) => (
                  <label key={c} className={`swatch${form.pastel_color === c ? ' sel' : ''}`} style={{ background: PASTEL_HEX[c] }}>
                    <input type="radio" name="pastel" checked={form.pastel_color === c} onChange={() => setForm({ ...form, pastel_color: c })} />
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Cover image</label>
              {!form.image_url ? (
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImageFile(f); }} disabled={uploading} />
              ) : (
                <div style={{ position: 'relative' }}>
                  <img src={form.image_url} alt="" style={{ borderRadius: 8, maxHeight: 140, width: '100%', objectFit: 'cover' }} />
                  <button
                    type="button"
                    className="x-btn"
                    aria-label="Remove image"
                    onClick={() => setForm({ ...form, image_url: '' })}
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'rgba(255,255,255,.9)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ marginBottom: 0 }}>Visible in shop</label>
              <label className="switch">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                <span className="track" /><span className="knob" />
              </label>
            </div>

            <div className="modal-actions">
              <button type="button" onClick={() => setFormOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="primary" onClick={save} disabled={busy || uploading || uploadingFile}>
                {busy ? 'Saving…' : editingId ? 'Save' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
