from flask import Flask, request, jsonify
from transformers import pipeline

# Crear la aplicación Flask
app = Flask(__name__)

# Inicializar los pipelines de resumen y traducción con modelos específicos
summarizer = pipeline("summarization", model="sshleifer/distilbart-cnn-12-6")  # Modelo de resumen
translator = pipeline("translation", model="Helsinki-NLP/opus-mt-en-es")  # Modelo de traducción inglés a español

# Ruta para resumir texto
@app.route('/summarize', methods=['POST'])
def summarize():
    data = request.get_json()
    text = data.get('text', '')
    summary = summarizer(text, max_length=50, min_length=25, do_sample=False)
    return jsonify(summary)

# Ruta para traducir texto
@app.route('/translate', methods=['POST'])
def translate():
    data = request.get_json()
    text = data.get('text', '')
    translation = translator(text)
    return jsonify(translation)

# Iniciar la aplicación
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
