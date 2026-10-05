#!/bin/bash
# Downloads the Lichess piece sets and board textures used as training data (see README.md).
cd "$(dirname "$0")"
set -e
mkdir -p sets boards
SETS="alpha anarcandy caliente california cardinal cburnett celtic chess7 chessnut companion cooke dubrovny fantasy firi fresca gioco governor horsey icpieces kiwen-suwi kosal leipzig maestro merida minimal-warmth mpchess papercut pirouetti pixel reillycraig rhosgfx riohacha shahi-ivory-brown spatial staunty tatiana totoy xkcd"
: > sets.cfg
for s in $SETS; do mkdir -p sets/$s; for p in wK wQ wR wB wN wP bK bQ bR bB bN bP; do echo "url = \"https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/$s/$p.svg\"" >> sets.cfg; echo "output = \"sets/$s/$p.svg\"" >> sets.cfg; done; done
curl -s -Z --parallel-max 24 -K sets.cfg
: > boards.cfg
for b in blue-marble.jpg blue2.jpg blue3.jpg canvas2.jpg green-plastic.png grey.jpg horsey.jpg ic.png leather.jpg maple.jpg maple2.jpg marble.jpg metal.jpg olive.jpg pink-pyramid.png purple-diag.png wood.jpg wood2.jpg wood3.jpg wood4.jpg; do echo "url = \"https://raw.githubusercontent.com/lichess-org/lila/master/public/images/board/$b\"" >> boards.cfg; echo "output = \"boards/$b\"" >> boards.cfg; done
curl -s -Z -K boards.cfg
