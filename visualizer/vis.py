from flask import Flask, request, send_file, send_from_directory
import argparse
import glob

parser = argparse.ArgumentParser()
parser.add_argument('--pred_path', type=str, required=True)
parser.add_argument('--visualizer', type=str, default='http://10.204.100.113:8001/')
parser.add_argument('--port', type=int, default=8120)
parser.add_argument('--host', type=str, default='0.0.0.0')
args = parser.parse_args()

def create_app():
    app = Flask(__name__)
    @app.route('/')
    def root():
        out = f"[#] Visualize predictions at {args.pred_path}"
        for file in glob.glob(f"{args.pred_path}/*.json"):
            out += f"<br><a href='{args.visualizer}?file={file}'>{file}</a>"
        return out
    return app

if __name__ == "__main__":
    app = create_app()
    app.run(host=args.host, port=args.port, debug=True)