#!/bin/sh

this=$(dirname $(readlink -f $0))
repo=$(git -C "$this" rev-parse --show-toplevel)

copybara=
dir=$repo
while [ "$dir" != "/" ]; do
    if [ -x "$dir/copybara.sh" ]; then copybara="$dir/copybara.sh"; break; fi
    dir=$(dirname "$dir")
done
if [ -z "$copybara" ]; then echo "copybara.sh not found above $repo" >&2; exit 1; fi

tmp=$(mktemp -d)
sed "s|url = \".\"|url = \"file://$repo\"|" "$this/proto.copy.bara.sky" > "$tmp/copy.bara.sky"
trap "rm -rf $tmp" EXIT

"$copybara" migrate "$tmp/copy.bara.sky" default "$@"
