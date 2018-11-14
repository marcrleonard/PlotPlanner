import click

from python.plotter import PlotControl

@click.command()

# add args here...
@click.option('--svg', prompt='SVG Location', help='The location of the svg to plot', default=None)
def setup(svg):

    # todo: check location of svg
    if svg == None:
        click.echo('No file provided.')

    pc = PlotControl()

    pc.setup_file(svg_string=svg)
    rv = pc.run()

    if rv:
        click.echo('Running SVG')
    else:
        click.echo('Error!')

if __name__ == '__main__':
    setup()