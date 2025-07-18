#!/usr/bin/env python3
"""
Test script to populate the Redis queue with sample data for dashboard testing.
"""

import requests
import time
import random

class QueueTester:
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url
        self.api_base = f"{base_url}/api"
        
    def add_sample_messages(self, count: int = 10):
        """Add sample messages to the queue."""
        print(f"🚀 Adding {count} sample messages to the queue...")
        
        message_types = ["email_send", "image_process", "data_sync", "notification", "backup"]
        
        for i in range(count):
            message = {
                "type": random.choice(message_types),
                "payload": {
                    "id": f"task_{i+1}",
                    "user_id": f"user_{random.randint(1, 100)}",
                    "data": f"Sample data for task {i+1}",
                    "timestamp": time.time()
                },
                "priority": random.choice([0, 0, 0, 1, 2])  # Mostly priority 0, some higher
            }
            
            try:
                response = requests.post(f"{self.api_base}/queue/message", json=message)
                if response.status_code == 201:
                    print(f"✅ Added message {i+1}: {message['type']}")
                else:
                    print(f"❌ Failed to add message {i+1}: {response.status_code}")
            except Exception as e:
                print(f"❌ Error adding message {i+1}: {e}")
            
            # Small delay to avoid overwhelming the server
            time.sleep(0.1)
    
    def dequeue_some_messages(self, count: int = 3):
        """Dequeue some messages to populate processing queue."""
        print(f"\n⚡ Dequeuing {count} messages (they'll go to processing queue)...")
        
        for i in range(count):
            try:
                response = requests.get(f"{self.api_base}/queue/message", params={"timeout": 1})
                if response.status_code == 200:
                    message = response.json()
                    print(f"✅ Dequeued message: {message.get('type', 'unknown')} (ID: {message.get('id', 'N/A')[:8]}...)")
                else:
                    print(f"❌ No messages available to dequeue")
                    break
            except Exception as e:
                print(f"❌ Error dequeuing message: {e}")
    
    def check_queue_status(self):
        """Check the current queue status."""
        print(f"\n📊 Checking queue status...")
        
        try:
            response = requests.get(f"{self.api_base}/queue/status")
            if response.status_code == 200:
                status = response.json()
                print(f"✅ Queue Status:")
                print(f"   📥 Main Queue: {status['mainQueue']['length']} messages")
                print(f"   ⚡ Processing Queue: {status['processingQueue']['length']} messages")
                print(f"   💀 Dead Letter Queue: {status['deadLetterQueue']['length']} messages")
                print(f"   📈 Total Processed: {status['metadata']['totalProcessed']}")
                print(f"   📉 Total Failed: {status['metadata']['totalFailed']}")
                return status
            else:
                print(f"❌ Failed to get queue status: {response.status_code}")
                return None
        except Exception as e:
            print(f"❌ Error getting queue status: {e}")
            return None
    
    def test_dashboard_access(self):
        """Test if the dashboard is accessible."""
        print(f"\n🌐 Testing dashboard access...")
        
        try:
            response = requests.get(f"{self.base_url}/dashboard")
            if response.status_code == 200:
                print(f"✅ Dashboard is accessible at {self.base_url}/dashboard")
                return True
            else:
                print(f"❌ Dashboard not accessible: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Error accessing dashboard: {e}")
            return False
    
    def run_demo(self):
        """Run a complete demo of the queue system."""
        print("🎯 Redis Queue Dashboard Demo")
        print("=" * 50)
        
        # Test dashboard access
        dashboard_ok = self.test_dashboard_access()
        
        # Add sample messages
        self.add_sample_messages(15)
        
        # Check initial status
        self.check_queue_status()
        
        # Dequeue some messages
        self.dequeue_some_messages(5)
        
        # Check status after dequeuing
        self.check_queue_status()
        
        print(f"\n🎉 Demo completed!")
        if dashboard_ok:
            print(f"🌐 Open your browser and go to: {self.base_url}/dashboard")
            print(f"📊 You should see the messages in different queues")
            print(f"🔄 The dashboard will auto-refresh every 5 seconds")
        
        print(f"\n💡 Tips:")
        print(f"   - Messages in processing queue will return to main queue after 30 seconds")
        print(f"   - Use the 'Refresh Now' button to update the dashboard immediately")
        print(f"   - The dashboard shows real-time queue statistics")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Test Redis Queue Dashboard")
    parser.add_argument(
        "--url", 
        default="http://localhost:3000",
        help="Base URL of the API server (default: http://localhost:3000)"
    )
    parser.add_argument(
        "--messages", 
        type=int,
        default=15,
        help="Number of sample messages to add (default: 15)"
    )
    
    args = parser.parse_args()
    
    tester = QueueTester(base_url=args.url)
    
    # Run the demo
    tester.run_demo()

if __name__ == "__main__":
    main()
