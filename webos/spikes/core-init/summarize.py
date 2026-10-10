#!/usr/bin/env python3
"""Resumo das medições do spike de init do core (F0.11).

  summarize.py run <prefixo> <variante> <tag> <params> <perfil> <uptime0> <uptime1> <ref0> <ref1> <variant.json>
      (chamado pelo run; lê as linhas dos lançamentos no stdin) → <prefixo>.json
  summarize.py table <arquivo.json>... → tabela em Markdown (medianas e faixas por variante e lançamento)
  summarize.py timeline <timeline.jsonl>... → quando o app aparece na tela (screen-timeline)

Tempos "desde o lançamento" usam o relógio do host a partir do ares-launch: o navigationStart da
página (relógio do convidado) é convertido com a diferença entre os relógios medida via CDP.
"""
import json
import re
import statistics
import sys


def load_page(path):
    raw = open(path).read().strip()
    try:
        page = json.loads(json.loads(raw)) if raw.startswith('"') else json.loads(raw)
    except ValueError:
        page = {'raw': raw[:2000]}
    return page if isinstance(page, dict) else {}


def read_samples(path):
    samples = []
    for line in open(path):
        parts = line.split()
        if len(parts) < 2 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        procs = {}
        for item in parts[2:]:
            try:
                name, pid, rss = item.rsplit(':', 2)
                procs[pid] = (name, int(rss))
            except ValueError:
                continue
        samples.append({'t': int(parts[0]), 'avail': int(parts[1]), 'procs': procs})
    return samples


def mb(kb):
    return round(kb / 1024, 1)


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def stage_ms(page, prefix):
    for s in page.get('stages') or []:
        if s['name'].startswith(prefix):
            return s['ms']
    return None


def memory(samples, g_launch, g_end, steady):
    before = [s for s in samples if g_launch - 6 <= s['t'] < g_launch]
    window = [s for s in samples if g_launch <= s['t'] <= g_end]
    if not before or not window:
        return {}
    avail0 = mean([s['avail'] for s in before])
    old = set().union(*[s['procs'].keys() for s in before])
    new = {}
    for s in window:
        for pid, (name, rss) in s['procs'].items():
            if pid not in old:
                new.setdefault(pid, []).append((s['t'], rss))
    app = max(new.values(), key=lambda v: max(r for _, r in v)) if new else None
    out = {'memAvailableBeforeMB': mb(avail0),
           'peak': {'memAvailableDropMB': mb(avail0 - min(s['avail'] for s in window)),
                    'appProcessMB': mb(max(r for _, r in app)) if app else None}}
    if steady:
        last = [s for s in window if s['t'] > g_end - 30]
        out['steady'] = {'memAvailableDropMB': mb(avail0 - mean([s['avail'] for s in last])),
                         'appProcessMB': mb(mean([r for t, r in app if t > g_end - 30])) if app else None}
    return out


def summarize_launch(base, row, samples, expect_variant):
    n, t_launch, t_done, done, g_launch, g_done, g_end, h0, h1, guest_ms = row.split()
    n, t_launch, t_done, g_launch, g_end = int(n), int(t_launch), int(t_done), int(g_launch), int(g_end)
    page = load_page('%s-L%d-page.json' % (base, n))
    t = page.get('timings') or {}
    loader = page.get('loader') or {}
    lt = loader.get('timings') or {}
    out = {'launch': n, 'completed': done == '1', 'launchToDoneHostMs': t_done - t_launch}
    # Diferença de relógio convidado − host (meio da janela da chamada CDP).
    try:
        offset = int(float(guest_ms)) - (int(h0) + int(h1)) / 2
        nav_host = page['navigationStart'] - offset
        out['launchToNavigationMs'] = round(nav_host - t_launch)
        out['clockSkewWindowMs'] = int(h1) - int(h0)
    except (KeyError, TypeError, ValueError):
        out['launchToNavigationMs'] = None
    l2n = out['launchToNavigationMs']

    def from_launch(ms):
        return round(l2n + ms) if l2n is not None and ms is not None else None

    ok_mark = stage_ms(page, 'loader wasm-ok') or stage_ms(page, 'loader wasm2js-ok')
    out['loader'] = {'variant': loader.get('variant'), 'reason': loader.get('reason'), 'timings': lt,
                     'moduleCache': (page.get('worker') or {}).get('moduleCache')}
    out['page'] = {
        'workerNewMs': stage_ms(page, 'worker-new'),
        'workerStartMs': stage_ms(page, 'worker-start'),
        'loaderStartMs': stage_ms(page, 'loader start'),
        'coreLoadedMs': ok_mark,
        'initCallMs': stage_ms(page, 'init-call'),
        'initDoneMs': t.get('initDoneMs'),
        'initMs': t.get('initMs'),
        'runtimeMs': round(t['initDoneMs'] - ok_mark, 1) if t.get('initDoneMs') and ok_mark else None,
        'firstPaintMs': t.get('firstPaintMs'),
        'cachedBoardPaintMs': t.get('cachedBoardPaintMs'),
        'liveBoardPaintMs': t.get('liveBoardPaintMs'),
        'discoverMs': (page.get('discover') or {}).get('ms'),
        'boardMs': (page.get('board') or {}).get('ms'),
    }
    out['fromLaunch'] = {
        'firstPaintMs': from_launch(t.get('firstPaintMs')),
        'cachedBoardPaintMs': from_launch(t.get('cachedBoardPaintMs')),
        'coreReadyMs': from_launch(t.get('initDoneMs')),
        'liveBoardPaintMs': from_launch(t.get('liveBoardPaintMs')),
    }
    out['mainThread'] = page.get('mainThread')
    out['memory'] = memory(samples, g_launch, g_end, steady=(n == 1))
    failures = []
    if done != '1':
        failures.append('a página não terminou (app caiu ou timeout)')
    if page.get('ok') is not True:
        failures.append('ok=%s' % page.get('ok'))
    if page.get('errors'):
        failures.append('erros: %s' % json.dumps(page['errors'])[:300])
    if loader.get('variant') != expect_variant:
        failures.append('variante %s, esperada %s' % (loader.get('variant'), expect_variant))
    out['passed'] = not failures
    out['failures'] = failures
    return out


def cmd_run(args):
    base, variant, tag, params, profile, up0, up1, ref0, ref1, variant_json = args
    rows = [line for line in sys.stdin.read().splitlines() if line.strip()]
    samples = read_samples(base + '-mem.log')
    expect = 'wasm2js' if tag.startswith('wasm2js') else 'wasm'
    launches = [summarize_launch(base, row, samples, expect) for row in rows]
    try:
        files = json.load(open(variant_json)).get('files')
    except (OSError, ValueError):
        files = None
    result = {
        'variant': variant, 'tag': tag, 'params': json.loads(params), 'profile': profile or None,
        'variantFiles': files,
        'host': {'uptimeStart': up0, 'uptimeEnd': up1, 'refMsStart': int(ref0), 'refMsEnd': int(ref1),
                 'load1Start': load1(up0), 'load1End': load1(up1)},
        'passed': all(l['passed'] for l in launches) and bool(launches),
        'launches': launches,
    }
    json.dump(result, open(base + '.json', 'w'), indent=2, ensure_ascii=False)
    for l in launches:
        p, f, m = l['page'], l['fromLaunch'], l['mainThread'] or {}
        d = m.get('duringInit') or {}
        print('L%d %s · %s · init %s ms (carga %s, runtime %s) · 1ª pintura %s · core pronto %s · Board vivo %s · '
              'Board do cache %s (ms desde o lançamento) · página no init: atraso p95 %s / máx %s ms, %s fps · mem %s' % (
                  l['launch'], 'PASSOU' if l['passed'] else 'FALHOU ' + '; '.join(l['failures']),
                  l['loader']['variant'], p['initMs'], l['loader']['timings'], p['runtimeMs'], f['firstPaintMs'],
                  f['coreReadyMs'], f['liveBoardPaintMs'], f['cachedBoardPaintMs'], d.get('beatDelayP95Ms'),
                  d.get('beatDelayMaxMs'), d.get('fps'), l['memory']))
    print(base + '.json')
    sys.exit(0 if result['passed'] else 1)


def load1(uptime):
    m = re.search(r'load average: ([0-9.]+)', uptime or '')
    return float(m.group(1)) if m else None


def fmt(values, scale=1000.0, digits=1):
    vals = [v for v in values if v is not None]
    if not vals:
        return '—'
    med = statistics.median(vals)
    s = ('%.' + str(digits) + 'f') % (med / scale)
    if len(vals) > 1:
        s += ' (%s–%s)' % (('%.' + str(digits) + 'f') % (min(vals) / scale), ('%.' + str(digits) + 'f') % (max(vals) / scale))
    return s.replace('.', ',')


def cmd_table(paths):
    runs = [json.load(open(p)) for p in paths]
    groups = {}
    for r in runs:
        key = (r['variant'], r['tag'], r.get('profile') or '—')
        groups.setdefault(key, []).append(r)
    head = ('| Variante | Caminho | Perfil | Lanç. | n (ok) | load 1 min | Init (s) | Carga do core (s) | Instanciação (s) | '
            'Runtime (s) | 1ª pintura (s)¹ | Board do cache (s)¹ | Core pronto (s)¹ | Board vivo (s)¹ | '
            'Página no init: atraso p95 / máx (ms) | fps no init | Pico MemAvailable / processo (MB) | Estável MemAvailable / processo (MB) |')
    print(head)
    print('|' + '|'.join(['---'] * (head.count('|') - 1)) + '|')
    for key in sorted(groups):
        rs = groups[key]
        nl = max(len(r['launches']) for r in rs)
        for i in range(nl):
            ls = [r['launches'][i] for r in rs if len(r['launches']) > i]
            ok = [l for l in ls if l['passed']]
            lt = [l['loader']['timings'] or {} for l in ok]
            load = [x.get('compileMs', x.get('wasm2jsLoadMs')) for x in lt]
            inst = [x.get('instantiateMs', x.get('wasm2jsInstantiateMs')) for x in lt]
            mt = [(l['mainThread'] or {}).get('duringInit') or {} for l in ok]
            mem = [l['memory'] for l in ok]
            loads = sorted(r['host']['load1Start'] for r in rs if r['host']['load1Start'] is not None)
            row = [key[0], key[1], key[2], str(i + 1), '%d (%d)' % (len(ls), len(ok)),
                   fmt(loads, 1),
                   fmt([l['page']['initMs'] for l in ok]),
                   fmt(load), fmt(inst),
                   fmt([l['page']['runtimeMs'] for l in ok]),
                   fmt([l['fromLaunch']['firstPaintMs'] for l in ok]),
                   fmt([l['fromLaunch']['cachedBoardPaintMs'] for l in ok]),
                   fmt([l['fromLaunch']['coreReadyMs'] for l in ok]),
                   fmt([l['fromLaunch']['liveBoardPaintMs'] for l in ok]),
                   '%s / %s' % (fmt([m.get('beatDelayP95Ms') for m in mt], 1, 0), fmt([m.get('beatDelayMaxMs') for m in mt], 1, 0)),
                   fmt([m.get('fps') for m in mt], 1, 0),
                   '%s / %s' % (fmt([(m.get('peak') or {}).get('memAvailableDropMB') for m in mem], 1, 0),
                                fmt([(m.get('peak') or {}).get('appProcessMB') for m in mem], 1, 0)),
                   '%s / %s' % (fmt([(m.get('steady') or {}).get('memAvailableDropMB') for m in mem], 1, 0),
                                fmt([(m.get('steady') or {}).get('appProcessMB') for m in mem], 1, 0)) if i == 0 else '—']
            print('| ' + ' | '.join(row) + ' |')
    print()
    print('Mediana (mínimo–máximo) das execuções que passaram. ¹ Desde o `ares-launch` (relógio do host). '
          'Lanç. 1 = 1º boot do app numa VM recém-criada; 2 e 3 = fechar e reabrir o app na mesma VM.')


def classify(mean):
    """Classe de um quadro do screen-timeline pelo brilho médio (cinza, 192×108)."""
    if mean < 3:
        return 'preto'        # transição
    if mean < 9:
        return 'tv'           # "Welcome to the webOS TV emulator" (camada de TV ao vivo, ~5)
    if 60 < mean < 85:
        return 'home'         # home/launcher do webOS (~73)
    return 'app'              # o app: splash (~12) ou Board (~23)


def first_stable(timeline, pred, n=2):
    """Primeiro quadro que satisfaz pred e é seguido por mais n-1 quadros que também satisfazem."""
    for i in range(len(timeline) - n + 1):
        if all(pred(x) for x in timeline[i:i + n]):
            return timeline[i]['ms'], (timeline[i - 1]['ms'] if i else None)
    return None, None


def cmd_timeline(paths):
    rows = []
    for path in paths:
        for line in open(path):
            d = json.loads(line)
            tl = d['timeline']
            for x in tl:
                x['class'] = classify(x['mean'])
            app, before = first_stable(tl, lambda x: x['class'] == 'app')
            board, _ = first_stable(tl, lambda x: x['class'] == 'app' and x['mean'] > 18)
            rows.append((json.dumps(d['params']), d['launch'], before, app, board, d.get('launchToNavigationMs'),
                         d.get('pageFirstPaintFromLaunchMs'), d.get('pageCachedBoardFromLaunchMs'),
                         d.get('coreReadyFromLaunchMs'), d.get('variant')))
    print('| Parâmetros | Lanç. | App na tela (ms)¹ | Board do cache na tela (ms) | Página: navegação / 1ª pintura / Board do cache (ms) | Core pronto (ms) | Variante |')
    print('|---|---|---|---|---|---|---|')
    for r in rows:
        cells = [r[0], r[1], r[2], r[3], r[4] or '—', r[5], r[6], r[7] or '—', r[8] or '—', r[9] or '—']
        print('| `%s` | %s | %s–%s | %s | %s / %s / %s | %s | %s |' % tuple(cells))
    print()
    print('Tempos desde o ares-launch (relógio do host). ¹ Entre a última captura sem o app e a primeira com o app '
          '(capturas QMP a cada ~0,1–0,2 s; duas seguidas com o app).')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'run':
        cmd_run(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == 'table':
        cmd_table(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == 'timeline':
        cmd_timeline(sys.argv[2:])
    else:
        print(__doc__)
        sys.exit(2)
