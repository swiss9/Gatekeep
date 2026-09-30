import { useEffect, useState } from 'react';
import { api, type Category, type Product } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

export function Categories() {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api.categories(), api.products({ all: true })])
      .then(([c, p]) => {
        setCategories(c.categories);
        setProducts(p.products);
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Load failed'));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countFor = (id: string) => products.filter((p) => p.category_id === id).length;

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toast('Enter a name');
    setBusy(true);
    try {
      await api.createCategory({ name: trimmed, position: categories.length });
      setName('');
      await load();
      toast('Category added');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  };

  const rename = async (c: Category) => {
    const next = window.prompt('Rename category', c.name);
    if (!next || next.trim() === c.name) return;
    try {
      await api.updateCategory(c.id, { name: next.trim() });
      await load();
      toast('Category renamed');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  const move = async (c: Category, dir: -1 | 1) => {
    const idx = categories.findIndex((x) => x.id === c.id);
    const swapWith = categories[idx + dir];
    if (!swapWith) return;
    try {
      await api.updateCategory(c.id, { position: swapWith.position });
      await api.updateCategory(swapWith.id, { position: c.position });
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Reorder failed');
    }
  };

  const remove = async (c: Category) => {
    const count = countFor(c.id);
    if (count > 0) {
      toast(`Move or delete ${count} product(s) first`);
      return;
    }
    if (!window.confirm(`Delete “${c.name}”?`)) return;
    try {
      await api.deleteCategory(c.id);
      await load();
      toast('Category deleted');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <>
      <div className="inv-list" style={{ marginTop: 16 }}>
        {categories.map((c, i) => (
          <div className="inv-row" key={c.id}>
            <div className="inv-info">
              <div className="inv-name">{c.name}</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                {countFor(c.id)} product(s)
              </div>
            </div>
            <button
              type="button"
              className="link-btn"
              disabled={i === 0}
              onClick={() => move(c, -1)}
              style={{ opacity: i === 0 ? 0.3 : 1 }}
            >
              ↑
            </button>
            <button
              type="button"
              className="link-btn"
              disabled={i === categories.length - 1}
              onClick={() => move(c, 1)}
              style={{ opacity: i === categories.length - 1 ? 0.3 : 1 }}
            >
              ↓
            </button>
            <button type="button" className="link-btn" onClick={() => rename(c)}>
              Rename
            </button>
            <button type="button" className="link-btn" onClick={() => remove(c)}>
              Delete
            </button>
          </div>
        ))}
        {categories.length === 0 && (
          <div className="inv-row">
            <div className="inv-info muted">No categories yet.</div>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="field" style={{ marginBottom: 8 }}>
          <label>New category</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home"
          />
        </div>
        <button type="button" className="btn-primary" onClick={add} disabled={busy}>
          {busy ? 'Adding…' : 'Add category'}
        </button>
      </div>
    </>
  );
}
