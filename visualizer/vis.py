from flask import Flask, request, send_file, send_from_directory
import argparse
import glob, os

parser = argparse.ArgumentParser()
parser.add_argument('--pred_path', type=str, required=True)
parser.add_argument('--visualizer', type=str, default='http://10.204.100.113:8001/')
parser.add_argument('--port', type=int, default=8120)
parser.add_argument('--host', type=str, default='0.0.0.0')
args = parser.parse_args()

# def create_app():
#     app = Flask(__name__)
#     @app.route('/')
#     def root():
#         out = f"[#] Visualize predictions at {args.pred_path}"
#         for file in glob.glob(f"{args.pred_path}/*.json"):
#             out += f"<br><a href='{args.visualizer}?file={file}'>{file}</a>"
#         return out
    

#     return app
def create_app():
    app = Flask(__name__)

    @app.route('/')
    def root():
        out = f"[#] Visualize predictions at {args.pred_path}<br><br>"

        # create a div of links
        for file in glob.glob(f"{args.pred_path}/*.json"):
            # use JavaScript to update iframe
            out += (
                f"<a href='#' onclick=\"document.getElementById('viewer').src='{args.visualizer}?file={file}';return false;\">"
                f"{file}</a><br>"
            )

        # add an iframe below
        out += (
            "<hr>"
            "<iframe id='viewer' width='1920' height='1080' style='border:1px solid #ccc;'></iframe>"
        )
        return out

    return app

if __name__ == "__main__":
    app = create_app()
    app.run(host=args.host, port=args.port, debug=True)