// netlify/functions/loyverse-items.js
//
// Trae TODOS los items activos de Loyverse (paginando con cursor) y
// devuelve un JSON liviano listo para el catálogo:
// { items: [{ id, name, price, category, image, inStock }] }
//
// NOTA IMPORTANTE: en esta cuenta de Loyverse, el campo "categoría" del
// item está usado para marcar el PROVEEDOR (El Nogal, NatNuts, etc.), no
// el tipo de producto. Por eso la categoría que se manda al frontend NO
// viene de Loyverse: se calcula clasificando el nombre del producto por
// palabras clave (ver CATEGORY_RULES más abajo), replicando las 16
// categorías reales que ya usa el catálogo de Raiden.
//
// Requiere la variable de entorno LOYVERSE_TOKEN configurada en
// Netlify (Site configuration -> Environment variables).

const LOYVERSE_BASE = 'https://api.loyverse.com/v1.0';

// Reglas de clasificación por palabra clave, de más específico a más
// genérico (la primera que matchea gana). Construidas a partir de los
// nombres reales de los productos de Raiden.
const CATEGORY_RULES = [
  // Orden de prioridad: de más específico a más genérico, para que
  // palabras ambiguas no le ganen a las más distintivas.
  { cat: '🍬 Dulces & Alfajores', words: ['ALFAJOR','BOMBON','CARAMELO','POLVORON','MERENGUE','COOKIE'] },
  { cat: '🍪 Galletitas & Snacks', words: ['GALLETITA','GALLETA','CHIPS','ARROCITA','CRACKER','BASTONI','ALMOHADITA','TOSTADA','SNACK','PITACHIPS','CHALITA','NUESTROS SABORES'] },
  { cat: '💪 Suplementos', words: ['STAR','PROTEIN','PROTEINA','WHEY','CREATINA','CREAPURE','XTRENGHT','NUTREMAX','BCAA','GLUTAMINA','PREENTRENO','PRE ENTRENO','MULTIVITAM','ZMA','TRIBULUS','OMEGA 3','OMEGA3','COLAGENO','COLÁGENO','MTOR','HYDROXY','SHAKER','THERMO','RESVERASTROL','MASS GAINER','MUTANTMASS','HYDRO SPORT','MAGNESIO','CAPS','TABS','SPORT DRINK','PROBIOTIC','KYOJIN','BIOTINA','GUMMIES','NATURE BOUNTY','FUNGINISTA','SAKER PREMIUM'] },
  { cat: '🍫 Barritas & Snacks Fit', words: ['BARRITA','BARRA','ALNUNA','CROWIE','LADDUBAR','WIKI TASTE','ZAFRAN','ENTRENUTS BARRA'] },
  { cat: '🥣 Granola & Cereales', words: ['GRANOLA','QUINOA POP','ARITO','ARITOS','GRAINS'] },
  { cat: '🧉 Yerba Mate', words: ['YERBA'] },
  { cat: '☕ Café & Té', words: ['CAFE EN LATA','CAFE FRIO','CAFE SOLUBLE','CAFE TOSTADO','TE FRASCO','SAQUITOS','LOVELY TEA','MAGICO HEREDIA','MONOHIERBAS','CAFEINA 60 CAPS'] },
  { cat: '🥛 Lácteos & Alternativas', words: ['YOGUR','QUESO','LACTOSA','GRIEGO','DANBO','CASANCREM','DULCE DE LECHE','KEFIR','SILK','LECHE UAT'] },
  { cat: '🍞 Panadería & Pastas', words: ['PAN ','PAN MOLDE','PANCAKE','MEDIALUNA','PIZZETA','BOLLITO','RAVIOL','WRAP','FIDEOS','TIRABUZON','TIRABUZÓN','PITA','BAGUETTE','CHIPA','TAPA EMP','FOCACCIA','SORRENTINO','SPAGUETTI','PANES','AVENTURA CHOCOLATE','RAPIDITAS'] },
  { cat: '🥜 Frutos Secos & Mezclas', words: ['NUECES','ALMENDRA','PASAS DE UVA','CIRUELA','DATIL','PISTACH','ARANDANO','CAJU','MANI ','MANÍ ','AVELLANA','MIX ','DESHIDRATADO','COCONUTS','ARROZ YAMANI','PAPAYA','MANZANA EN CUBOS','BUDIN','BUDÍN'] },
  { cat: '🌾 Harinas, Granos & Semillas', words: ['HARINA','ARROZ','AVENA','SEMILLA','GARBANZO','SOJA TEXTURIZADA','PSYLLIUM','LEVADURA NUTRIC','POLVO PARA HORNEAR','ZAPALLO SEMILLAS','BLEND HARINAS','PREMEZCLA','CACAO AMARGO','QUINOA','GELATINA'] },
  { cat: '🧊 Congelados & Helados', words: ['HELADO','BIOMAC','GERGAL','WAFFLE','AIR FRYER','BURGER VEGANA','VEGETALEX MEDALLON'] },
  { cat: '🌱 Vegano & Plant-based', words: ['HUMMUS','TOFU','VEGGIELAND','GUACAMOLE','BABAGANUSH','VEGANO','VEGANA','NOT BURGER','NOT CHORIZO','NOT SALCHICHA'] },
  { cat: '🫙 Aceites, Salsas & Untables', words: ['ACEITE','VINAGRE','MERMELADA','SALSA','MAYONESA','KETCHUP','MUSTARD','UNTABLE','PASTA DE MANI','PASTA DE MANÍ','MANTEQUILLA DE MANI','AZUCAR','AZÚCAR','SAL HIMALAYA','SAL VARIEDADES','SAL MARINA','STEVIA','MIEL','GHEE','ESCABECHE','CONFITADO','MOSTAZA','PESTO','ADEREZO','SALMUERA'] },
  { cat: '🥤 Bebidas', words: ['AGUA ','JUGO','LIMONADA','CERVEZA','KOMBU','AQUALOE','SODA','GASEOSA','ENERGIZANTE','ISOTONIC','DETOX','MONSTER','PURE TOMATE','ALOE KING','UNREAL WATER','NAGUAL'] },
];

function classifyCategory(productName) {
  const upper = (productName || '').toUpperCase();
  for (const rule of CATEGORY_RULES) {
    for (const w of rule.words) {
      if (upper.includes(w)) return rule.cat;
    }
  }
  return '✨ Bienestar & Otros';
}

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
    // 1) Traer todos los items, paginando con cursor
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

    // 1.5) Traer inventario real por variante desde /inventory
    // Devuelve { variant_id, in_stock } por cada variante con tracking activo.
    // Si una variante no aparece en /inventory → no tiene tracking → se muestra disponible.
    const inventoryMap = {}; // variant_id → in_stock (número)
    try {
      let invCursor = null;
      do {
        const url = new URL(`${LOYVERSE_BASE}/inventory`);
        url.searchParams.set('limit', '250');
        if (invCursor) url.searchParams.set('cursor', invCursor);

        const res = await fetch(url.toString(), { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          (data.inventory_levels || []).forEach((inv) => {
            if (inv.variant_id != null) {
              inventoryMap[inv.variant_id] = inv.in_stock ?? null;
            }
          });
          invCursor = data.cursor || null;
        } else {
          invCursor = null; // si falla inventory, seguimos sin él
        }
      } while (invCursor);
    } catch (invErr) {
      // Si /inventory falla (permisos, etc.), seguimos solo con available_for_sale
      console.warn('No se pudo cargar inventario:', invErr.message);
    }

    // 1.6) Ordenar por fecha de creación (más nuevo primero)
    const hasCreatedAt = allItems.some((it) => it.created_at);
    if (hasCreatedAt) {
      allItems.sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
    }
    const NEW_COUNT = 10;

    // 2) Mapear cada item al formato simple que usa el frontend
    const cleanItems = [];
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      if (item.deleted_at) continue;

      const variants = item.variants || [];
      let price = null;
      let inStock = true;

      if (variants.length > 0) {
        const v = variants[0];
        if (v.stores && v.stores.length > 0) {
          const store = v.stores[0];
          price = store.price != null ? store.price : v.default_price;

          // Determinar stock combinando dos fuentes:
          // 1. available_for_sale: si está en false, sin stock (desactivado manualmente)
          // 2. inventoryMap: si tiene tracking activo y cantidad <= 0, sin stock
          const availableForSale = store.available_for_sale !== false;
          const stockQty = inventoryMap[v.variant_id] ?? null;
          const hasTracking = stockQty !== null;

          if (!availableForSale) {
            inStock = false; // desactivado manualmente en Loyverse
          } else if (hasTracking) {
            inStock = stockQty > 0; // tiene tracking: 0 o negativo = sin stock
          } else {
            inStock = true; // sin tracking activo = asumimos disponible
          }
        } else {
          price = v.default_price;
        }
      }
      if (price == null) price = item.default_price;
      if (price == null) continue;

      cleanItems.push({
        id: item.id,
        name: item.item_name,
        price: Math.round(price),
        category: classifyCategory(item.item_name),
        image: item.image_url || null,
        inStock: inStock,
        isNew: i < NEW_COUNT,
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
