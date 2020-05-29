

from python.svgsort.paper_utils import PAPER, make_paper

import sys
import traceback

from docopt import docopt

from python.svgsort import Svgsort
# from .paper_utils import PAPER
# from .paper_utils import make_paper



def main(args, return_string=False):
  try:
    _in = args['<in>']
    out = args['<out>'] if args['<out>'] else args['<in>']+'-srt'
    adjust = not args['--no-adjust']
    penmoves = args['--pen-moves']

    svgs = Svgsort(sw=args['--sw']).load(_in)

    min_x, min_y, width, height = svgs.svg_atr.get('viewBox').split(' ')
    original_is_portrait= True
    if width > height:
        original_is_portrait = False

    if args['--no-split']:
      pass
    elif args['--split-all']:
      svgs.eager_split()
    else:
      # default
      svgs.split()

    if args['--no-sort']:
      # do not sort
      pass
    else:
      svgs.sort(rnd=args['--rnd'])

    if args['--repeat']:
      svgs.repeat()

    if penmoves:
      svgs.make_pen_move_paths()

    dim = args['--dim'].strip().lower()
    paper = PAPER.get(dim, None)
    if paper is None:
      try:
        paper = make_paper(tuple([int(d) for d in args['--dim'].split('x')]))
      except Exception:
        raise ValueError('wrong dim/paper size')

    if return_string:
      return ''

    svg_out = ''

    preserve_orientation = args.get('preserve_orientation', False)

    if adjust:
      svg_out = svgs.save(out, paper=paper, pad=float(args['--pad']),
                padAbs=bool(args['--pad-abs']),
                          preserve_orientation=preserve_orientation,
                          original_is_portrait=original_is_portrait)

    else:
      svg_out = svgs.save_no_adjust(out)

    return svg_out

  except Exception:
    traceback.print_exc(file=sys.stdout)
    exit(1)


if __name__ == '__main__':
  args = {'--dim': 'A3',
          '--no-adjust': False,
          '--no-sort': False,
          '--no-split': False,
          '--pad': '200',
          '--pad-abs': True,
          '--pen-moves': False,
          '--repeat': False,
          '--rnd': False,
          '--split-all': False,
          '--sw': '1.0',
          '<in>': 'test.svg',
          '<out>': 'test_out.svg'
          }

  main(args)
