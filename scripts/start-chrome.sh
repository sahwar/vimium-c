#!/usr/bin/env bash

VER=
FLAGS=
OTHER_EXT=
GUD=/r/TEMP/GUD
WORKING_DIR=/r/working

while [[ $# -gt 0 ]]; do
case "$1" in
  clean|--clean)
    if test -d "$GUD"; then
      rm -rf "$GUD" || exit $?
      dir=${GUD}; dir=${dir#/}; gud_w=${dir%%/*}; dir=${dir#[a-z]}
      gud_w=${gud_w^}:${dir}
      echo -E "Clean ${gud_w} : done."
    fi
    shift
    ;;
  exp|--exp)
    FLAGS=$FLAGS" --enable-experimental-web-platform-features --javascript-harmony --enable-experimental-canvas-features"
    shift
    ;;
  leg|legacy|--legacy)
    FLAGS=$FLAGS" --disable-javascript-harmony-shipping"
    shift
    ;;
  only|--only)
    exit 0
    ;;
  *) # ver
    VER=$1
    shift
    ;;
esac
done

if test -f "/usr/bin/env.exe"; then
  RUN=/usr/bin/start2.exe
  PATH=/usr/bin/cygpath.exe
else
  RUN=$(which env.exe)' start2.exe'
  PATH=/bin/wslpath
fi

dir=$(/usr/bin/realpath "${BASH_SOURCE[0]}")
if test -f dir/Chrome/chrome.exe; then
  CHROME_ROOT=$dir
  VC_EXT=E:/Git/weidu+vim/vimium-c
else
  CHROME_ROOT='/d/Program Files/Google'
  dir=${dir%/*}; dir=${dir%/*}; dir=${dir#/}; VC_EXT=${dir%%/*}; dir=${dir#[a-z]}
  VC_EXT=${VC_EXT^}:${dir}
fi
if test "$VER" == wo; then
  EXE=$WORKING_DIR/Chrome-bin/chrome.exe
else
  EXE=$CHROME_ROOT/${VER:-Chrome}/chrome.exe
fi
if test "$VER" == wo || test ${VER:-99} -ge 45; then
  ub=${VC_EXT}/../uBlock/dist/build/uBlock0.chromium
  test -d "$ub" && OTHER_EXT=${OTHER_EXT},${ub}
fi

exe_w=$($PATH -m "$EXE")
if ! test -f "$EXE"; then
  echo -E "No such a file: "$exe_w >&2
  exit 1
fi

test -d "$WORKING_DIR" && cd "$WORKING_DIR" 2>/dev/null || cd "${EXE%/*}"

# Refer: https://peter.sh/experiments/chromium-command-line-switches/
echo -E Run: "${exe_w}" at ${GUD} with "${VC_EXT}"
$RUN "$EXE" \
  --user-data-dir=${GUD} \
  --load-extension=${VC_EXT}${OTHER_EXT} \
  --homepage chrome-extension://hfjbmagddngcpeloejdejnfgbamkjaeg/pages/options.html \
  --disable-office-editing-component-extension \
  --start-maximized $FLAGS "$@"
