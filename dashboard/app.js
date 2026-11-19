// Token Radar's plain dashboard, rewritten. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the model's own inputs and the protocol's farm
// plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATASET = window.RADAR;
  if (!DATASET) return;
  var mount = document.getElementById('board');
  var view = {
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    q: '',
    category: 'all',
    chain: 'all',
    minTvl: 0,
    watchlistOnly: false,
    selected: null,
  };

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function moneyShort(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return moneyFmt.format(n);
  }
  function pctText(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model as one function: the page works a row out again from the snapshot figures and
  // checks the number board.json carries, so the page's arithmetic and the board's data are
  // visibly the same. It is worked out from the raw snapshot figures, exactly as lib/model.ts
  // does it: the category multiple comes from the unrounded multiples table, never from the
  // row's rounded display copy.
  function recomputeImplied(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + ((growth / 100) * model.growth_weight);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + ((Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
    var chainCount = (row.chains || []).length;
    var breadth = 1 + model.breadth_step * Math.min(Math.max(chainCount - 1, 0), model.breadth_max_chains);
    var multiples = DATASET.category_multiples || {};
    var mult = multiples[row.category || 'Other'];
    if (mult === undefined) mult = DATASET.global_multiple;
    return Math.max(1, Math.round(((row.tvl_usd * mult) * growthMult) * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        for (var j = 0; j < child.length; j++) {
          if (child[j]) node.appendChild(child[j]);
        }
      } else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan comes from the same derivation main.ts writes to board.json: category, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased.
  function firstChainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function stakeAmount(p) {
    var tvl = p.tvl_usd;
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function holdLength(age) {
    if (age === null || age === undefined || age >= 365) return 30;
    if (age < 180) return 60;
    return 45;
  }
  function actionSentence(p, capital, chain) {
    var cat = (p.category || '').toLowerCase();
    var name = p.name;
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
    if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0 || cat.indexOf('leveraged farm') >= 0) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
    if (cat.indexOf('bridge') >= 0) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
    if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
    if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
    if (cat.indexOf('prediction') >= 0) return `Fund $${capital} and place one market position on ${name}.`;
    if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
    if (cat.indexOf('stable') >= 0) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    if (cat.indexOf('rwa') >= 0) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
    if (cat.indexOf('insurance') >= 0) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
    return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
  function stepSentence(step) {
    var s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
    if (s.length > 600) s = `${s.slice(0, 596)}...`;
    if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
    return s;
  }
  function gasCost(chain) {
    var priceByChain = { Ethereum: 8, Bitcoin: 4 };
    var price = priceByChain[chain];
    return price === undefined ? 1 : price;
  }
  function weeklyPhrase(p) {
    var cat = (p.category || '').toLowerCase();
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) return 'a supply, a borrow or a repayment';
    if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0 || cat.indexOf('leveraged farm') >= 0) return 'a swap or a liquidity change';
    if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) return 'a small trade or a margin change';
    if (cat.indexOf('prediction') >= 0) return 'a market position or a settlement';
    if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0) return 'a deposit, a withdrawal or a vault vote';
    if (cat.indexOf('rwa') >= 0 || cat.indexOf('stable') >= 0) return 'a mint, a deposit or a redemption';
    if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) return 'a stake, a restake or a claim';
    return 'a deposit, a swap or a vote';
  }
  function planFor(p) {
    var chain = firstChainOf(p);
    var capital = stakeAmount(p);
    var hold = holdLength(p.age_days);
    var gas = gasCost(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: `about $${gas} of gas for the first transaction on ${chain}`, time: '5 minutes' },
      { text: actionSentence(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
      { text: `Make one qualifying action each week, such as ${weeklyPhrase(p)}.`, cost: `about $${gas} of gas a week`, time: '10 minutes a week' },
      { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
      { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepSentence);
  }

  function loadHash() {
    var raw = window.location.hash;
    if (!raw || raw.length < 2) return;
    var params = new URLSearchParams(raw.slice(1));
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
  }
  function saveHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.selected) params.set('p', view.selected);
    var query = params.toString();
    var target = query ? '#' + query : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', target);
  }

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    var onWatchlist = {};
    (DATASET.watchlist || []).forEach(function (s) { onWatchlist[s] = true; });
    return DATASET.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && !(r.chains || []).some(function (c) { return c === view.chain; })) return false;
      if (r.tvl_usd < view.minTvl) return false;
      if (view.watchlistOnly && !onWatchlist[r.slug]) return false;
      if (!q) return true;
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
      return hay.includes(q);
    });
  }
  function orderedRows(list) {
    var key = view.sort;
    function sortValue(r) {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
      return r.implied_value_usd;
    }
    return list.slice().sort(function (a, b) {
      var av = sortValue(a);
      var bv = sortValue(b);
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug === b.slug ? 0 : a.slug < b.slug ? -1 : 1;
    });
  }

  function topBar() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: `Snapshot ${DATASET.as_of}` }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: `${DATASET.model_version} model` })
      )
    );
  }

  function introBar() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: `${DATASET.board_size} pre-token protocols, ranked by implied value` }),
        el('p', { text: `The watchlist is the floor: every protocol with at least $${Math.round(DATASET.floor_usd / 1e6)}M of TVL and no token on record. The early radar adds ${DATASET.early_size} more below that floor, every one of them pre-token and none of them a wrapped, staked or bridged product of a token that already trades. Implied value is a model, not a promise.` })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: `${DATASET.watchlist_size} / ${DATASET.watchlist_size}` })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATASET.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATASET.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATASET.live_size) }))
      )
    );
  }

  function filterBar() {
    var categories = Array.from(new Set(DATASET.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATASET.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; saveHash(); draw(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { view.category = select.value; saveHash(); draw(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; draw(); });
    var tvlSelect = el('select', { id: 'min-tvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      [5e6, 5e7, 1e8, 5e8, 1e9].map(function (v) { return el('option', { value: String(v), text: `TVL >= ${moneyShort(v)}`, selected: view.minTvl === v ? 'selected' : null }); })
    );
    tvlSelect.addEventListener('change', function () { view.minTvl = Number(tvlSelect.value); draw(); });
    var watchBtn = el('button', { type: 'button', 'aria-pressed': view.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { view.watchlistOnly = !view.watchlistOnly; draw(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; draw(); } });
    var live = el('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; draw(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'min-tvl', text: 'Min TVL' }), tvlSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Watchlist' }), el('div', { class: 'tabs' }, watchBtn)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: view.tab === 'pre-token' ? `${visibleRows().length} rows shown` : `${DATASET.live.length} live-token protocols` })
    );
  }

  function sortCell(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } draw(); } },
        label,
        view.sort === key ? el('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardGrid() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.minTvl = 0; view.watchlistOnly = false; saveHash(); draw(); } })
      ));
    }
    var top = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (row) {
      var growth = row.change_7d === null ? 'n/a' : pctText(row.change_7d);
      var growthClass = row.change_7d === null ? '' : row.change_7d >= 0 ? 'pos' : 'neg';
      var share = Math.round((row.implied_value_usd / top) * 100);
      var tr = el('tr', {
        'data-selected': view.selected === row.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showDetail(row.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(row.slug); } }
      },
        el('td', { class: 'num', text: String(row.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: row.name }),
          el('span', { class: 'sub', text: `${row.category || 'Other'} on ${(row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain')}` })
        )),
        el('td', { class: 'num', text: moneyShort(row.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: ageText(row.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(3, share)}%` })),
          el('span', { class: 'num', text: moneyShort(row.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortCell('implied', 'Rank'),
            sortCell('name', 'Protocol'),
            sortCell('tvl', 'TVL'),
            sortCell('growth', '7d'),
            sortCell('age', 'Age'),
            sortCell('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveGrid() {
    var tbody = el('tbody');
    DATASET.live.slice(0, 25).forEach(function (p) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'live' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: p.name }),
          el('span', { class: 'sub', text: `${p.category || 'Other'} on ${(p.chains && p.chains.length ? p.chains.slice(0, 2).join(', ') : 'an unnamed chain')}` })
        )),
        el('td', { class: 'num', text: moneyShort(p.tvl_usd) }),
        el('td', { class: 'num', text: p.change_7d === null ? 'n/a' : pctText(p.change_7d) }),
        el('td', { class: 'num', text: moneyShort(p.market_cap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelCard() {
    var m = DATASET.model;
    var cats = Object.keys(DATASET.category_multiples).sort();
    var rows = cats.map(function (cat) {
      return el('div', { class: 'mult' }, el('span', { text: cat }), el('b', { class: 'num', text: `x${DATASET.category_multiples[cat].toFixed(3)}` }));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: `implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ${m.growth_floor}, ${m.growth_cap}) / 100 x ${m.growth_weight}) x (${m.maturity_floor} + min(age_days, ${m.maturity_days}) / ${m.maturity_days} x ${m.maturity_range}) x (1 + 0.05 x min(chains - 1, 4)) )` }),
      el('p', { class: 'sub', text: `The category multiple is the median market-cap / TVL of the snapshot\u2019s live-token protocols in the same category (at least ${m.multiple_min_peers} peers), else the global median of x${DATASET.global_multiple.toFixed(3)}, clamped to [${m.multiple_floor.toFixed(2)}, ${m.multiple_cap.toFixed(2)}]. It is computed from the snapshot at run time, never written in by hand. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ${m.unknown_age_days} days. Wrapped, staked and bridged products of tokens that already trade are excluded from the board and from the peer set.` }),
      el('h3', { text: 'Category multiples from live-token peers' }),
      el('div', { class: 'mults' }, rows)
    );
  }

  var drawer = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  drawer.addEventListener('close', function () { view.selected = null; saveHash(); });

  function showDetail(slug) {
    var row = DATASET.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    saveHash();
    var m = DATASET.model;
    var again = recomputeImplied(row, m);
    drawer.textContent = '';
    drawer.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: `Rank ${row.rank} of ${DATASET.board_size}` }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: `${row.category || 'Other'} on ${(row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain')}` })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { drawer.close(); } })
    ));
    function eqRow(label, value) { return el('div', null, el('span', { text: label }), el('b', { class: 'num', text: value })); }
    drawer.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        eqRow('TVL', moneyShort(row.tvl_usd)),
        eqRow(`Category multiple (${row.category || 'Other'})`, 'x' + row.category_multiple),
        eqRow('Seven-day growth', pctText(row.change_7d)),
        eqRow('Age with no token', ageText(row.age_days)),
        eqRow('Chains', String((row.chains || []).length)),
        eqRow('Growth multiplier', String(row.growth_multiplier)),
        eqRow('Maturity multiplier', String(row.maturity_multiplier)),
        eqRow('Breadth multiplier', String(row.breadth_multiplier)),
        eqRow('Implied value', moneyShort(row.implied_value_usd))
      ),
      el('p', { class: 'sub', text: `Model ${DATASET.model_version}: the same function scores every protocol. The page recomputes this row as ${moneyShort(again)}${again === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.'} This is an estimate, not a price.` })
    ));
    drawer.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, planFor(row).map(function (s) {
        var cut = s.indexOf(' Cost: ');
        var action = cut >= 0 ? s.slice(0, cut) : s;
        var tail = cut >= 0 ? s.slice(cut + 1) : '';
        var bold = el('b', { text: action });
        var cost = el('span', { class: 'cost', text: tail });
        return el('li', null, bold, cost);
      }))
    ));
    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute('open', '');
    }
  }

  function draw() {
    mount.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(introBar());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? boardGrid() : liveGrid());
    if (view.tab === 'pre-token') shell.appendChild(modelCard());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) mount.appendChild(drawer);
    if (view.selected) showDetail(view.selected);
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.open) drawer.close();
  });
  loadHash();
  draw();
})();
