// netlify/functions/loyverse-items.js
//
// Trae TODOS los items activos de Loyverse (paginando con cursor),
// resuelve el nombre de categoría (Loyverse solo da category_id en /items),
// y devuelve un JSON liviano listo para el catálogo:
// { items: [{ id, name, price, category, image, inStock }] }
//
// Requiere la variable de entorno LOYVERSE_TOKEN configurada en
// Netlify (Site settings -> Environment variables).

const LOYVERSE_BASE = 'https://api.loyverse.com/v1.0';

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  const token = process.env.LOYVERSE_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Falta configurar LOYVERSE_TOKEN en Netlify.' }),
    };
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1) Traer todas las categorías y armar un mapa id -> nombre
    const categoriesMap = {};
    let catCursor = null;
    do {
      const url = new URL(`${LOYVERSE_BASE}/categories`);
      url.searchParams.set('limit', '250');
      if (catCursor) url.searchParams.set('cursor', catCursor);

      const res = await fetch(url.toString(), { headers: authHeaders });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Loyverse categories ${res.status}: ${detail}`);
      }
      const data = await res.json();
      (data.categories || []).forEach((c) => {
        categoriesMap[c.id] = c.name;
      });
      catCursor = data.cursor || null;
    } while (catCursor);

    // 2) Traer todos los items, paginando con cursor
    const allItems = [];
    let itemCursor = null;
    do {
      const url = new URL(`${LOYVERSE_BASE}/items`);
      url.searchParams.set('limit', '250');
      if (itemCursor) url.searchParams.set('cursor', itemCursor);

      const res = await fetch(url.toString(), { headers: authHeaders });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Loyverse items ${res.status}: ${detail}`);
      }
      const data = await res.json();
      (data.items || []).forEach((item) => allItems.push(item));
      itemCursor = data.cursor || null;
    } while (itemCursor);

    // 3) Mapear cada item al formato simple que usa el frontend
    const cleanItems = [];
    for (const item of allItems) {
      // Saltar items eliminados/archivados si Loyverse los marca
      if (item.deleted_at) continue;

      const variants = item.variants || [];
      // Tomar el precio de la primera variante; fallback a default_price del item
      let price = null;
      let inStock = null;

      if (variants.length > 0) {
        const v = variants[0];
        if (v.stores && v.stores.length > 0) {
          price = v.stores[0].price != null ? v.stores[0].price : v.default_price;
          inStock = v.stores[0].available_for_sale != null
            ? v.stores[0].available_for_sale
            : null;
        } else {
          price = v.default_price;
        }
      }
      if (price == null) price = item.default_price;
      if (price == null) continue; // sin precio no se puede vender online

      const categoryName = categoriesMap[item.category_id] || 'Otros';

      cleanItems.push({
        id: item.id,
        name: item.item_name,
        price: Math.round(price),
        category: categoryName,
        image: item.image_url || null,
        inStock: inStock,
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items: cleanItems,
        count: cleanItems.length,
        updatedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
