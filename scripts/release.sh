#!/bin/sh

this=$(dirname $(readlink -f $0))
repo=$(git -C "$this" rev-parse --show-toplevel)

tmp=$(mktemp -d)
sed "s|url = \".\"|url = \"file://$repo\"|" "$this/copy.bara.sky" > "$tmp/copy.bara.sky"
trap "rm -rf $tmp" EXIT

../../copybara.sh migrate "$tmp/copy.bara.sky" default
