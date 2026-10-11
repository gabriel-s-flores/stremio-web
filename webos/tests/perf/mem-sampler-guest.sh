# Runs ON the emulator (sent by mem-sampler.sh through `ssh ... sh -s`, with PERIOD and THREADS defined before it).
# One line per sample on stdout:
#   <MemAvailable kB> <name>:<pid>:<VmRSS kB>:<RssAnon kB>:<RssFile kB>:<RssShmem kB> ...
# and, when THREADS=1, a second line per sample:
#   T <name>:<ticks> ...        CPU ticks (utime+stime, 100 per second, since the thread started) of the app
#                               renderer's threads, summed by thread name (WorkerPool/123 -> WorkerPool): who
#                               works when the memory moves. The renderer is the WebAppMgr --type=renderer with the
#                               most RSS. It costs a `ps` and one more awk per sample.
while true; do
  awk 'FNR==1 { n=""; r=0 } /^MemAvailable:/ { a=$2 } /^Name:/ { n=$2 } /^VmRSS:/ { r=$2 } /^RssAnon:/ { an=$2 } /^RssFile:/ { fi=$2 } /^RssShmem:/ { if (n != "" && (r > 5000 || n ~ /WebAppMgr|umediaserver|pipeline|starfish|gst-|node|stremio/)) { split(FILENAME, p, "/"); l = l " " n ":" p[3] ":" r ":" an ":" fi ":" $2 } } END { print a l }' /proc/meminfo /proc/[0-9]*/status 2>/dev/null
  if [ "$THREADS" = 1 ]; then
    p=$(ps -eo pid,rss,args | grep -e '--type=renderer' | grep -v grep | sort -k2 -n | tail -1 | awk '{print $1}')
    [ -n "$p" ] && awk '{ i = index($0, "("); j = 0; for (k = length($0); k > 0; k--) if (substr($0, k, 1) == ")") { j = k; break } name = substr($0, i + 1, j - i - 1); sub(/\/[0-9]+$/, "", name); gsub(/ /, "_", name); split(substr($0, j + 2), f, " "); t[name] += f[12] + f[13] } END { l = "T"; for (nm in t) l = l " " nm ":" t[nm]; print l }' /proc/$p/task/*/stat 2>/dev/null
  fi
  sleep "$PERIOD"
done
