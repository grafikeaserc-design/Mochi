import numpy as np
import json
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix

# ==========================================
# 1. Load Dataset from task.json
# ==========================================
with open('task.json', 'r') as f:
    task_data = json.load(f)

# Parsing fields 'input' and 'intent' based on task_data inspection
if isinstance(task_data, list):
    if len(task_data) > 0 and isinstance(task_data[0], dict):
        texts = [item['input'] for item in task_data]
        labels = [item['intent'] for item in task_data]
    else:
        texts, labels = zip(*task_data)
else:
    if 'inputs' in task_data and 'intents' in task_data:
        texts = task_data['inputs']
        labels = task_data['intents']
    else:
        raise ValueError("Unsupported JSON structure in task.json.")

dataset_size = len(texts)

# ==========================================
# 2. Train / Validation Dataset Split (80/20)
# ==========================================
X_train, X_val, y_train, y_val = train_test_split(
    texts,
    labels,
    test_size=0.20,
    random_state=42,
    stratify=labels
)

print(f"Total Dataset Size: {dataset_size} samples")
print(f"Training Set Size: {len(X_train)} samples")
print(f"Validation Set Size: {len(X_val)} samples\n")

# ==========================================
# 3. Model Pipeline Construction
# ==========================================
model = make_pipeline(
    TfidfVectorizer(ngram_range=(1, 2), lowercase=True),
    LogisticRegression(C=1.5, solver='liblinear')
)

# ==========================================
# 4. Train Model
# ==========================================
model.fit(X_train, y_train)

# ==========================================
# 5. Validation Evaluation
# ==========================================
y_pred = model.predict(X_val)
val_accuracy = accuracy_score(y_val, y_pred)

print(f"=== VALIDATION ACCURACY: {val_accuracy * 100:.2f}% ===\n")

print("=== CLASSIFICATION REPORT ===")
print(classification_report(y_val, y_pred, zero_division=0))

classes = sorted(list(set(labels)))
print("=== CONFUSION MATRIX ===")
cm = confusion_matrix(y_val, y_pred, labels=classes)
print(f"Classes: {classes}\n")
print(cm)

# ==========================================
# 6. Diagnostic Test
# ==========================================

diagnostic_samples = [
    "Can you book a meeting for tomorrow at 2 PM?",
    "Please cancel my upcoming appointment",
    "Show me what is scheduled for today",
    "Remind me to call the doctor at 6 PM",
    "Set a countdown timer for 10 minutes",
    "Create a new task to buy groceries",
    "Search the web for the latest tech news",
    "Save this code snippet to my notes",
    "hi mochi",
    "see you soon",
    "What is your name"
]

print("=== RUNNING DIAGNOSTIC TEST ===\n")
for sample in diagnostic_samples:
    predicted_intent = model.predict([sample])[0]
    probabilities = model.predict_proba([sample])[0]
    class_index = list(model.classes_).index(predicted_intent)
    confidence = probabilities[class_index]

    print(f"Input: '{sample}'")
    print(f"Predicted: {predicted_intent} (Confidence: {confidence * 100:.2f}%)\n")

# ==========================================
# 7. Exporting The Weights.
# ==========================================

vectorizer = model.named_steps["tfidfvectorizer"]
classifier = model.named_steps["logisticregression"]

model_data = {
    "vocabulary": vectorizer.vocabulary_,
    "idf": vectorizer.idf_.tolist(),
    "use_idf": vectorizer.use_idf,
    "ngram_min": vectorizer.ngram_range[0],
    "ngram_max": vectorizer.ngram_range[1],
    "lowercase": vectorizer.lowercase,
    "token_pattern": vectorizer.token_pattern,
    "coef": classifier.coef_.tolist(),
    "intercept": classifier.intercept_.tolist(),
    "classes": classifier.classes_.tolist(),
}

with open("model_weights.json", "w") as f:
  json.dump(model_data, f)

print("Exported model_weights.json successfully with bigram support!")