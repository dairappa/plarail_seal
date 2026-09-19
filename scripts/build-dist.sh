#!/usr/bin/env sh
# 配信用ファイルを dist/ に集め、CSS / JS の参照にバージョン（コミット SHA）を付ける。
# GitHub Pages は静的ファイルを 10 分キャッシュするため、HTML だけ新しく CSS / JS が古い
# 組み合わせが起きる。URL を変えればブラウザは必ず新しいファイルを取りに行く。
set -eu
cd "$(dirname "$0")/.."
V="${1:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"
rm -rf dist
mkdir -p dist
cp -r index.html css js .nojekyll dist/
# index.html の参照
sed -i "s/?v=dev/?v=$V/g" dist/index.html
# ES モジュール同士の import
sed -i -E "s#(from '\./[A-Za-z_]+\.js)'#\1?v=$V'#g" dist/js/*.js
echo "built dist/ (v=$V)"
